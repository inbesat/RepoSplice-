// P-185 — Provenance: the transport contract for the UI.
//
// Users must be able to inspect where every file came from without leaving the
// app: a per-file origin lookup (tooltip/panel) and a full explorer. The WEB views
// are later phases (P-221/P-229) — this module is the CONTRACT they and the CLI
// server share, plus pure handlers that are trivially testable.
//
// WHY THERE IS NO `Elysia` IMPORT HERE (ADR-058). The phase sketches
// `provenanceRoutes(ctx, { getMap }): Elysia.Routes`, but `elysia` is a dependency
// of `packages/cli` (1.4.30) and is deliberately NOT a dependency of core — core's
// own package description reserves the HTTP/WS server for the CLI. Importing it
// here would demand a dependency core does not declare (breaking a
// frozen-lockfile install) and would push a server framework down a layer. So the
// shape is inverted: core exports framework-agnostic route DESCRIPTORS with pure
// handlers, and the CLI's Elysia server BINDS them at P-193 — which is what the
// phase's own step 4 asks for ("wire into the CLI server so web can fetch"), and
// what its own test line assumes ("route handler with fake ctx/getMap").
//
// Three properties are load-bearing:
//
//   EMAIL IS OMITTED UNLESS ASKED FOR. This is the third default-closed gate over
//   contributor addresses: P-181 only STORES one behind its own opt-in, P-182 only
//   RENDERS one behind its own flag, and this serializer only TRANSPORTS one when
//   told to. Three independent defaults, all off.
//
//   404 IS A VALUE, NOT A FAILURE. An unknown path is a normal answer; only a real
//   defect (a renderer that returned `err`) becomes a 500, so a caller can tell
//   "no such file" from "the server is broken".
//
//   THE STATS MIRROR CREDITS. `unattributed` and `agentEdited` use the same
//   predicates P-182 renders with, so the panel and the document cannot disagree
//   about what an unattributed file is.

import { type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { generateCredits } from './credits.js';
import {
  type FileOrigin,
  type ProvenanceMap,
  type SourceRepoLabel,
  type StitchedBy,
} from './map.js';

/** One file's origin, as transported. Field set mirrors {@link FileOrigin}. */
export interface ProvenanceFileDto {
  file: string;
  repo: SourceRepoLabel;
  remoteUrl?: string;
  sourceCommit: string;
  sourcePath: string;
  sourceAuthor?: string;
  /** Present ONLY when the caller asked for emails (see the module header). */
  sourceEmail?: string;
  copiedAt: string;
  stitchedBy: StitchedBy;
}

/** The map's summary counts, computed with P-182's predicates. */
export interface ProvenanceStatsDto {
  total: number;
  /** Count per repo label (`A`, `B`, `unknown`). */
  byRepo: Record<string, number>;
  /** Files the agent stitched. */
  agentEdited: number;
  /** Files nothing could be attributed to (`repo: 'unknown'`). */
  unattributed: number;
}

/** The transport form of the map. */
export interface ProvenanceMapDto {
  files: ProvenanceFileDto[];
  stats: ProvenanceStatsDto;
}

/** Options for {@link serializeProvenanceMap}. */
export interface SerializeProvenanceOptions {
  /** Transport `sourceEmail`. Default `false` (the PII-safe posture). */
  includeEmails?: boolean;
}

/** One origin, with the email stripped unless it was requested. */
function toFileDto(origin: FileOrigin, includeEmails: boolean): ProvenanceFileDto {
  return {
    file: origin.file,
    repo: origin.repo,
    ...(origin.remoteUrl !== undefined ? { remoteUrl: origin.remoteUrl } : {}),
    sourceCommit: origin.sourceCommit,
    sourcePath: origin.sourcePath,
    ...(origin.sourceAuthor !== undefined ? { sourceAuthor: origin.sourceAuthor } : {}),
    // The gate: a retained address is not transported unless asked for.
    ...(includeEmails && origin.sourceEmail !== undefined
      ? { sourceEmail: origin.sourceEmail }
      : {}),
    copiedAt: origin.copiedAt,
    stitchedBy: origin.stitchedBy,
  };
}

/**
 * Convert a map to plain JSON.
 *
 * `origins()` is already sorted by path (P-282), so the transport order is stable
 * and a client can diff two responses.
 */
export function serializeProvenanceMap(
  map: ProvenanceMap,
  opts: SerializeProvenanceOptions = {}
): ProvenanceMapDto {
  const includeEmails = opts.includeEmails === true;
  const origins = map.origins();

  const byRepo: Record<string, number> = {};
  let agentEdited = 0;
  let unattributed = 0;
  for (const origin of origins) {
    byRepo[origin.repo] = (byRepo[origin.repo] ?? 0) + 1;
    if (origin.stitchedBy === 'agent') agentEdited += 1;
    // The same predicate P-182 renders "unattributed" from.
    if (origin.repo === 'unknown') unattributed += 1;
  }

  return {
    files: origins.map(origin => toFileDto(origin, includeEmails)),
    stats: { total: origins.length, byRepo, agentEdited, unattributed },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** What a handler is given. Kept minimal on purpose. */
export interface RouteRequest {
  /** Query parameters, already decoded by the host. */
  query?: Record<string, string | undefined>;
}

/** What a handler answers with. `status` is part of the contract. */
export interface RouteResponse {
  status: number;
  body: unknown;
}

/** A pure handler: request in, response out, no framework. */
export type RouteHandler = (request: RouteRequest) => Promise<RouteResponse> | RouteResponse;

/** One declarative route the CLI server binds. */
export interface RouteDescriptor {
  method: 'GET';
  /** The path this phase's acceptance names exactly. */
  path: string;
  handler: RouteHandler;
}

/**
 * What `ctx` must be able to do.
 *
 * The CLI passes an adapter over its Elysia app; a test passes a recorder. This is
 * why the first parameter is USED rather than ignored: registration is the point.
 */
export interface RouteHost {
  register(route: RouteDescriptor): void;
}

/** Dependency + policy for {@link provenanceRoutes}. */
export interface ProvenanceRoutesOptions {
  /** Supplies the current map. May be async (the pipeline builds it per job). */
  getMap: () => ProvenanceMap | Promise<ProvenanceMap>;
  /** Transport emails. Default `false`. */
  includeEmails?: boolean;
  /**
   * Renders `/api/credits`. Defaults to P-182's `generateCredits`, which is
   * render-only when no `repoC` is given — so this route never touches disk.
   */
  getCredits?: (map: ProvenanceMap) => Promise<Result<string, StitchError>>;
}

/** The paths, so a binder and the tests agree without re-typing them. */
export const PROVENANCE_ROUTES = {
  map: '/api/provenance',
  file: '/api/provenance/file',
  credits: '/api/credits',
} as const;

/** A `StitchError`'s message, narrowed (not every variant carries one). */
function errorText(error: StitchError): string {
  return 'message' in error && typeof error.message === 'string' ? error.message : error.code;
}

/**
 * Build the three routes as pure handlers.
 *
 * `GET /api/provenance`          → the full map + stats.
 * `GET /api/provenance/file?path=` → one origin, `404` when the map has no such
 *                                    file, `400` when `path` is missing.
 * `GET /api/credits`             → the CREDITS markdown (P-182).
 */
export function buildProvenanceRoutes(opts: ProvenanceRoutesOptions): RouteDescriptor[] {
  const includeEmails = opts.includeEmails === true;
  const getCredits = opts.getCredits ?? ((map: ProvenanceMap) => generateCredits(map, {}));

  const mapRoute: RouteDescriptor = {
    method: 'GET',
    path: PROVENANCE_ROUTES.map,
    handler: async () => {
      const map = await opts.getMap();
      return { status: 200, body: serializeProvenanceMap(map, { includeEmails }) };
    },
  };

  const fileRoute: RouteDescriptor = {
    method: 'GET',
    path: PROVENANCE_ROUTES.file,
    handler: async request => {
      const path = request.query?.['path'];
      // A MISSING parameter is the caller's mistake (400); an unknown path is a
      // normal miss (404). Collapsing them would tell a client the wrong thing.
      if (path === undefined || path.trim() === '') {
        return { status: 400, body: { message: 'query parameter "path" is required' } };
      }
      const map = await opts.getMap();
      // `getOrigin` normalises separators, so a Windows-style path resolves
      // without this handler re-implementing lookup.
      const origin = map.getOrigin(path);
      if (origin === undefined) {
        return { status: 404, body: { message: `no provenance for ${path}` } };
      }
      return { status: 200, body: { file: toFileDto(origin, includeEmails) } };
    },
  };

  const creditsRoute: RouteDescriptor = {
    method: 'GET',
    path: PROVENANCE_ROUTES.credits,
    handler: async () => {
      const map = await opts.getMap();
      const rendered = await getCredits(map);
      if (rendered.isErr()) {
        // A genuine failure, distinct from an empty document.
        return { status: 500, body: { message: errorText(rendered.error) } };
      }
      return { status: 200, body: rendered.value };
    },
  };

  return [mapRoute, fileRoute, creditsRoute];
}

/**
 * Build the routes AND register them with the host.
 *
 * The descriptors are returned as well, so a caller (or a test) can drive the
 * handlers directly without a server anywhere in sight.
 */
export function provenanceRoutes(ctx: RouteHost, opts: ProvenanceRoutesOptions): RouteDescriptor[] {
  const routes = buildProvenanceRoutes(opts);
  for (const route of routes) ctx.register(route);
  return routes;
}

/** A `RouteHost` that records instead of serving — for tests and dry runs. */
export function recordingRouteHost(): RouteHost & { routes: RouteDescriptor[] } {
  const routes: RouteDescriptor[] = [];
  return {
    routes,
    register: route => {
      routes.push(route);
    },
  };
}
