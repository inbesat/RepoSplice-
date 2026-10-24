// P-252 — the OpenAPI 3 document generated FROM the contract's zod schemas.
//
// One source, two consumers: `stitch serve` mounts this at `/api-docs.json`
// (+ a plain page at `/api-docs`) and the web client's generated typings come
// from the same document, so the two sides cannot describe different APIs.
//
// Nothing here throws: a schema zod cannot render as JSON Schema is reported
// as a `CONFIG_ERROR` on field `api.openapi` so `serve` can answer 500 with a
// reason instead of crashing the server.

import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { StitchError } from '../result/index.js';
import {
  API_CONTRACT_VERSION,
  API_DOCS_PATH,
  API_ROUTES,
  type ApiMethod,
  type ApiRoute,
} from './contract.js';

/** The document `serve` serializes; deliberately structural, not `any`. */
export interface OpenApiDocument {
  readonly openapi: '3.0.3';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly servers: readonly { readonly url: string }[];
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
  /** The repo's own marker, so a stale document is visible at a glance. */
  readonly 'x-contract-version': string;
}

/** One operation: its operationId, its bodies and its failure mode. */
export interface OpenApiOperation {
  readonly operationId: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly requestBody?: {
    readonly required: true;
    readonly content: Readonly<Record<string, { readonly schema: unknown }>>;
  };
  readonly responses: Readonly<Record<string, unknown>>;
}

/** `/api/repos/:id/tree` -> `/api/repos/{id}/tree` (OpenAPI's own syntax). */
export function openApiPath(template: string): string {
  return template
    .split('/')
    .map(segment => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment))
    .join('/');
}

/** The tag an operation groups under (`jobs.list` -> `jobs`). */
export function tagFor(route: ApiRoute): string {
  const dot = route.id.indexOf('.');
  return dot === -1 ? 'system' : route.id.slice(0, dot);
}

function schemaOf(schema: z.ZodType): Result<unknown, StitchError> {
  try {
    return ok(z.toJSONSchema(schema));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err({
      code: 'CONFIG_ERROR',
      field: 'api.openapi',
      message: `the schema for this route cannot be rendered as JSON Schema: ${message}`,
    } satisfies StitchError);
  }
}

function operationFor(route: ApiRoute): Result<OpenApiOperation, StitchError> {
  const response = schemaOf(route.response);
  if (response.isErr()) return err(response.error);

  const responses: Record<string, unknown> = {
    '200': {
      description:
        route.placeholderResponse === true
          ? `The placeholder reply this route answers until its owning phase wires the data.`
          : 'The route reply.',
      content: { 'application/json': { schema: response.value } },
    },
  };

  if (route.request !== undefined) {
    const request = schemaOf(route.request);
    if (request.isErr()) return err(request.error);
    responses['422'] = {
      description:
        'The body does not match the schema. The reason is the `message` of a CONFIG_ERROR on field api.request.',
      content: { 'application/json': { schema: { type: 'object' } } },
    };
    return ok({
      operationId: route.id,
      summary: route.summary,
      tags: [tagFor(route)],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: request.value } },
      },
      responses,
    });
  }

  return ok({
    operationId: route.id,
    summary: route.summary,
    tags: [tagFor(route)],
    responses,
  });
}

/** Build the whole document, or the first schema that could not be rendered. */
export function buildOpenApiDocument(): Result<OpenApiDocument, StitchError> {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  for (const route of API_ROUTES) {
    const operation = operationFor(route);
    if (operation.isErr()) return err(operation.error);
    const path = openApiPath(route.path);
    const methods = paths[path] ?? {};
    methods[route.method.toLowerCase()] = operation.value;
    paths[path] = methods;
  }

  return ok({
    openapi: '3.0.3',
    info: {
      title: 'RepoSplice CLI server API',
      version: API_CONTRACT_VERSION,
      description:
        'Generated from the zod contract in packages/core/src/api/contract.ts (P-252). ' +
        '`serve` validates inbound bodies against the same schemas (422 on a mismatch) ' +
        `and answers the document itself at ${API_DOCS_PATH}.`,
    },
    servers: [{ url: '/' }],
    paths,
    components: { schemas: {} },
    'x-contract-version': API_CONTRACT_VERSION,
  });
}

/** The HTTP status a validation refusal maps to (P-203's mapping). */
export function statusForContractError(error: StitchError): number {
  return error.code === 'CONFIG_ERROR' &&
    (error.field === 'api.request' || error.field === 'api.response')
    ? 422
    : 500;
}

/** Every route id the document carries, sorted (used by the conformance spec). */
export function documentedRouteIds(): readonly string[] {
  return API_ROUTES.map(route => route.id).sort((left, right) => left.localeCompare(right));
}

/** The methods the document advertises for one path template. */
export function methodsFor(route: ApiRoute): ApiMethod {
  return route.method;
}
