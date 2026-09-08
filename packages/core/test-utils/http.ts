import nock from 'nock';

/**
 * Shared HTTP mocks (P-063) for hermetic, offline-safe suites: GitHub API
 * (P-101), AI providers (P-144/P-027/P-028), sandbox registry calls.
 *
 * Backend: nock (root devDep, probed: v14 intercepts both global fetch and
 * Octokit under vitest workers — no local server needed). `mockttp` is also
 * installed at root for future suites that need a real local server; these
 * helpers stay on nock so tests never bind ports.
 *
 * Hermeticity: every helper call blocks ALL real network except loopback
 * (`localhost`/`127.0.0.1`, kept open so mockttp-based suites keep working
 * alongside these). Unmocked requests fail fast with `Disallowed net
 * connect` instead of hanging. Call `cleanupHttpMocks()` in `afterEach`
 * (see `src/__tests__/http-mocks.test.ts`) so interceptors never leak
 * between suites.
 *
 * Throwing by design: `done()`/`assertNoPending()` throw on unsatisfied
 * mocks — that IS the assertion mechanism in test context (vitest fails the
 * test). Production code paths are unaffected; production APIs keep
 * returning `Result` and never throw.
 */

/** JSON-ish reply body: decoded object or plain text. */
export type MockBody = string | Record<string, unknown>;

/** One intercepted route. */
export interface HttpMock {
  /** True once the route has been hit. */
  isDone(): boolean;
  /** Human-readable interceptors still waiting (empty when satisfied). */
  pending(): string[];
  /** Throw if the route was never hit. */
  done(): void;
}

class NockHttpMock implements HttpMock {
  constructor(private readonly scope: nock.Scope) {}

  isDone(): boolean {
    return this.scope.isDone();
  }

  pending(): string[] {
    return this.scope.pendingMocks();
  }

  done(): void {
    this.scope.done();
  }
}

/** Block real network for the calling suite (loopback stays open). */
function lockNet(): void {
  nock.disableNetConnect();
  nock.enableNetConnect('localhost');
  nock.enableNetConnect('127.0.0.1');
}

/** Intercept `GET base+path` with a fixed status + JSON/text body. */
export function mockGet(base: string, path: string, status: number, body: MockBody): HttpMock {
  lockNet();
  return new NockHttpMock(nock(base).get(path).reply(status, body));
}

/** Intercept `POST base+path` with a fixed status + JSON/text body. */
export function mockPost(base: string, path: string, status: number, body: MockBody): HttpMock {
  lockNet();
  return new NockHttpMock(nock(base).post(path).reply(status, body));
}

/**
 * Throw unless every given mock was consumed. With no arguments, throws
 * unless NO interceptors remain anywhere (catches strays from any helper).
 */
export function assertNoPending(scopes: readonly HttpMock[] = []): void {
  if (scopes.length === 0) {
    const pending = nock.pendingMocks();
    if (pending.length > 0) {
      throw new Error(`HTTP mocks not yet satisfied:\n${pending.join('\n')}`);
    }
    return;
  }
  const pending = scopes.flatMap(scope => scope.pending());
  if (pending.length > 0) {
    throw new Error(`HTTP mocks not yet satisfied:\n${pending.join('\n')}`);
  }
}

/** Remove all interceptors and restore real network. Call in `afterEach`. */
export function cleanupHttpMocks(): void {
  nock.cleanAll();
  nock.enableNetConnect();
}
