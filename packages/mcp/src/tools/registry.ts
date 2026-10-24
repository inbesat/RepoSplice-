// P-357 - the MCP tool registry.
//
// A tool is a name, a description, a JSON Schema for its arguments and a
// handler. A handler may return a `Result` (the core convention), a plain
// value, or a promise of either; the registry normalizes all three so callers
// only ever see `Result<unknown, StitchError>`. A handler that THROWS is caught
// here and converted, so a buggy tool can never take the server down.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

/** The JSON Schema of a tool's arguments (the MCP `inputSchema`). */
export interface ToolInputSchema {
  readonly type: 'object';
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
}

/** What a client sees in `tools/list`. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
}

/** What a handler may return. */
export type ToolOutcome = Result<unknown, StitchError> | unknown;

/** How a tool is invoked. */
export type ToolHandler = (
  args: Readonly<Record<string, unknown>>
) => ToolOutcome | Promise<ToolOutcome>;

interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly handler: ToolHandler;
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause !== null && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(cause);
}

/** Does this value look like a neverthrow `Result`? */
function isResultLike(value: unknown): value is Result<unknown, StitchError> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'isOk' in value &&
    typeof (value as { isOk?: unknown }).isOk === 'function'
  );
}

/** Normalize a handler's return value into a `Result`. */
function toResult(value: ToolOutcome): Result<unknown, StitchError> {
  return isResultLike(value) ? value : ok(value);
}

/** Tool arguments arrive as JSON, so anything object-shaped is accepted. */
function normalizeArgs(args: unknown): Result<Readonly<Record<string, unknown>>, StitchError> {
  if (args === undefined || args === null) return ok({});
  if (typeof args !== 'object' || Array.isArray(args)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'mcp.arguments',
      message: 'tool arguments must be a JSON object',
    });
  }
  return ok(args as Readonly<Record<string, unknown>>);
}

/**
 * The registry of MCP tools.
 *
 * `list()` returns the descriptors in a stable (alphabetical) order so a
 * client sees the same tool set every time.
 */
export class ToolRegistry {
  private readonly entries = new Map<string, RegisteredTool>();

  /** Register a tool. A duplicate name is refused, never overwritten. */
  register(definition: ToolDefinition, handler: ToolHandler): Result<void, StitchError> {
    if (this.entries.has(definition.name)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'mcp.tool',
        message: `the tool ${definition.name} is already registered`,
      });
    }
    this.entries.set(definition.name, { definition, handler });
    return ok(undefined);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** The registered tool names, alphabetical. */
  names(): readonly string[] {
    return [...this.entries.keys()].sort((left, right) => left.localeCompare(right));
  }

  /** The descriptors a client sees in `tools/list`, alphabetical. */
  list(): readonly ToolDefinition[] {
    return this.names().map(name => {
      const entry = this.entries.get(name);
      // `names()` is derived from the same map, so this is always present.
      return entry === undefined
        ? { name, description: '', inputSchema: { type: 'object' } }
        : entry.definition;
    });
  }

  /** Invoke a tool. An unknown name, bad arguments or a throw is a Result error. */
  async call(name: string, args: unknown): Promise<Result<unknown, StitchError>> {
    const entry = this.entries.get(name);
    if (entry === undefined) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'mcp.tool',
        message: `no tool named ${name} is registered`,
      });
    }
    const normalized = normalizeArgs(args);
    if (normalized.isErr()) return err(normalized.error);
    try {
      return toResult(await entry.handler(normalized.value));
    } catch (cause) {
      return err({
        code: 'INTERNAL',
        message: `the tool ${name} failed: ${messageOf(cause)}`,
      });
    }
  }
}

/** Build an empty registry. */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
