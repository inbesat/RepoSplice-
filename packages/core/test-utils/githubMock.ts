/**
 * Shared mocked-Octokit harness (P-101) for the GitHub epic (P-088–P-100):
 * ONE fake covering every narrow client seam, so suites stop hand-rolling
 * per-module fakes and the epic suite proves the seams compose.
 *
 * The mock is a DUMB dispatcher: it records `{ namespace, method, args }`
 * per call and returns whatever the scripted handler returns (a
 * `MockResponse`-shaped value) or throws whatever the handler throws
 * (an `Error`, usually from `reqError`). Response SHAPES stay in the
 * suites (or the fixtures below) — the harness never invents payloads.
 *
 * Seam fidelity (the P-089 lesson): every method name mirrors Octokit
 * exactly, and the returned mock assigns to each narrow `*Client` type
 * WITHOUT casts — drift breaks compilation. Runtime drift is caught by
 * each suite's nock end-to-end proofs against the real Octokit.
 *
 * P-282 determinism: fixed SHAs plus fixture builders producing the
 * same bytes on every run; no clocks, no randomness, no network.
 *
 * Throwing by design: the default handler throws on unscripted calls,
 * and `reqError` builds throwable statuses — that IS the assertion
 * mechanism in test context (vitest fails the test). Production code
 * paths are unaffected.
 */

/** Resolved Octokit response shape every seam speaks. */
export interface MockResponse {
  data: unknown;
  headers: unknown;
  status: number;
}

/** One recorded call: Octokit namespace + method + raw args. */
export interface MockCall {
  namespace: string;
  method: string;
  args: Record<string, unknown>;
}

/**
 * Scripted behavior per call: return a `MockResponse`-shaped value or
 * throw an `Error` (thrown `RequestError`-shaped errors map by status,
 * like the real Octokit).
 */
export type MockHandler = (call: MockCall) => unknown;

/** Fixed SHAs shared by every suite (deterministic, never generated). */
export const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/**
 * Throwable status error mirroring Octokit's `RequestError` surface
 * (`.status` plus assignable `.headers`). Attach headers post-hoc:
 * `(error as Error & { headers?: unknown }).headers = {...}`.
 */
export function reqError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/** Resolved 2xx envelope (override `status` for resolved non-2xx). */
export function okResponse(data: unknown, status = 200): MockResponse {
  return { data, headers: {}, status };
}

/** Narrow method signature every mocked endpoint speaks (args optional: `getAuthenticated` takes none). */
type MockMethod = (args?: Record<string, unknown>) => Promise<MockResponse>;

/** The universal fake: every GitHub seam, one dispatcher, full call log. */
export interface MockOctokit {
  rest: {
    users: {
      getAuthenticated: MockMethod;
    };
    repos: {
      get: MockMethod;
      getCommit: MockMethod;
      getContent: MockMethod;
      listForAuthenticatedUser: MockMethod;
      createForAuthenticatedUser: MockMethod;
      createInOrg: MockMethod;
      createFork: MockMethod;
      updateBranchProtection: MockMethod;
      createCommitStatus: MockMethod;
      createDispatchEvent: MockMethod;
    };
    git: {
      createRef: MockMethod;
      deleteRef: MockMethod;
      getTree: MockMethod;
    };
    pulls: {
      create: MockMethod;
      list: MockMethod;
    };
    actions: {
      getWorkflowRun: MockMethod;
      listWorkflowRunsForRepo: MockMethod;
      createWorkflowDispatch: MockMethod;
    };
    licenses: {
      getForRepo: MockMethod;
    };
    search: {
      repos: MockMethod;
    };
  };
  /** v4 query: returns the handler output unwrapped (suites shape it). */
  graphql(query: string, variables?: Record<string, unknown>): Promise<unknown>;
  /** Every call in order (assert routing + short-circuits off this). */
  calls: MockCall[];
}

function toMethod(
  namespace: string,
  method: string,
  handler: MockHandler,
  calls: MockCall[]
): MockMethod {
  return async (args?: Record<string, unknown>): Promise<MockResponse> => {
    const call: MockCall = { namespace, method, args: { ...args } };
    calls.push(call);
    const out = handler(call);
    if (out instanceof Error) throw out;
    return out as MockResponse;
  };
}

/**
 * Build the universal fake around a scripted handler. Omit the handler
 * to fail loud on the first call (unscripted suites surface instantly).
 */
export function mockOctokit(handler: MockHandler = defaultHandler): MockOctokit {
  const calls: MockCall[] = [];
  const method = (namespace: string, name: string): MockMethod =>
    toMethod(namespace, name, handler, calls);
  return {
    rest: {
      users: {
        getAuthenticated: method('users', 'getAuthenticated'),
      },
      repos: {
        get: method('repos', 'get'),
        getCommit: method('repos', 'getCommit'),
        getContent: method('repos', 'getContent'),
        listForAuthenticatedUser: method('repos', 'listForAuthenticatedUser'),
        createForAuthenticatedUser: method('repos', 'createForAuthenticatedUser'),
        createInOrg: method('repos', 'createInOrg'),
        createFork: method('repos', 'createFork'),
        updateBranchProtection: method('repos', 'updateBranchProtection'),
        createCommitStatus: method('repos', 'createCommitStatus'),
        createDispatchEvent: method('repos', 'createDispatchEvent'),
      },
      git: {
        createRef: method('git', 'createRef'),
        deleteRef: method('git', 'deleteRef'),
        getTree: method('git', 'getTree'),
      },
      pulls: {
        create: method('pulls', 'create'),
        list: method('pulls', 'list'),
      },
      actions: {
        getWorkflowRun: method('actions', 'getWorkflowRun'),
        listWorkflowRunsForRepo: method('actions', 'listWorkflowRunsForRepo'),
        createWorkflowDispatch: method('actions', 'createWorkflowDispatch'),
      },
      licenses: {
        getForRepo: method('licenses', 'getForRepo'),
      },
      search: {
        repos: method('search', 'repos'),
      },
    },
    graphql: async (query: string, variables?: Record<string, unknown>): Promise<unknown> => {
      const call: MockCall = { namespace: 'graphql', method: 'graphql', args: { query } };
      if (variables !== undefined) {
        call.args.variables = variables;
      }
      calls.push(call);
      const out = handler(call);
      if (out instanceof Error) throw out;
      return out as unknown;
    },
    calls,
  };
}

function defaultHandler(call: MockCall): unknown {
  throw new Error(`unscripted mock call: ${call.namespace}.${call.method}`);
}

// ─── fixtures (P-282: same bytes every run) ────────────────────────────

/** Repo list item carrying the fields `parseRepo` reads. */
export function fixtureRepoItem(owner: string, name: string): Record<string, unknown> {
  return {
    name,
    full_name: `${owner}/${name}`,
    owner: { login: owner },
    default_branch: 'main',
    private: false,
  };
}

/** licenses.getForRepo envelope for one SPDX id (null = no license). */
export function fixtureLicensePayload(spdxId: string | null): MockResponse {
  return {
    data: {
      license:
        spdxId === null
          ? null
          : {
              key: spdxId.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              name: `${spdxId} License`,
              spdx_id: spdxId,
              url: 'https://api.github.com/licenses/x',
              node_id: 'MDc6TGljZW5zZXg=',
            },
    },
    headers: {},
    status: 200,
  };
}

/** One workflow run record carrying the fields `parseRun` reads. */
export function fixtureRun(
  id: number,
  sha: string,
  status: string,
  conclusion: string | null,
  branch: string | null = 'main'
): Record<string, unknown> {
  return {
    id,
    head_sha: sha,
    head_branch: branch,
    status,
    conclusion,
    html_url: `https://github.com/o/r/actions/runs/${id}`,
  };
}

/** listWorkflowRunsForRepo envelope around run records. */
export function fixtureRunList(runs: Record<string, unknown>[]): MockResponse {
  return {
    data: { total_count: runs.length, workflow_runs: runs },
    headers: {},
    status: 200,
  };
}
