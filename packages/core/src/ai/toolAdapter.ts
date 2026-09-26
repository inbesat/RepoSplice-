// Zod+JSON Tool Adapter (P-139).
//
// Converts Zod schemas to JSON Schema for providers, and parses/validates
// tool-call arguments returned by models against the original Zod schema.

import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import type { ToolSchema } from './types.js';
import { type StitchError } from '../result/index.js';

/**
 * Convert a Zod schema object to a JSON Schema compatible with providers.
 * Uses zod 4's native `z.toJSONSchema` (draft 2020-12 target) — the
 * standalone `zod-to-json-schema` package only accepts zod 3 types.
 * @param schema - Record of field name to Zod type
 * @returns JSON Schema object
 */
export function zodToJsonSchema(schema: Record<string, z.ZodTypeAny>): Record<string, unknown> {
  const objectSchema = z.object(schema);
  return z.toJSONSchema(objectSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
}

/**
 * Parse and validate tool arguments against a Zod schema.
 * Handles both object and JSON-string inputs from model responses.
 * @param schema - Record of field name to Zod type
 * @param raw - Raw arguments from model (object or JSON string)
 * @param strict - If true, strip unknown keys instead of failing (default false)
 * @returns Result with typed data on success, StitchError on failure
 */
export function parseToolArgs<T extends Record<string, unknown>>(
  schema: Record<string, z.ZodTypeAny>,
  raw: unknown,
  strict: boolean = false
): Result<T, StitchError> {
  let parsed: unknown;

  // Coerce string input to object
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err({
        code: 'TOOL_ARGS_INVALID_JSON',
        message: 'Tool arguments is not valid JSON',
      });
    }
  } else {
    parsed = raw;
  }

  // Ensure parsed is an object
  if (!parsed || typeof parsed !== 'object') {
    return err({
      code: 'TOOL_ARGS_VALIDATION',
      message: 'Tool arguments must be an object',
    });
  }

  // Build Zod object schema
  // strict:true  → strip unknown keys (z.object default)
  // strict:false → fail on unknown keys (.strict())
  const objectSchema = strict ? z.object(schema) : z.object(schema).strict();

  // Validate
  const result = objectSchema.safeParse(parsed);
  if (result.success) {
    return ok(result.data as T);
  }

  // Build readable error message with paths
  const issues = result.error.issues.map(i => {
    const path = i.path.length > 0 ? '/' + i.path.join('/') : '(root)';
    return `${path}: ${i.message}`;
  });

  return err({
    code: 'TOOL_ARGS_VALIDATION',
    message: `Tool arguments validation failed: ${issues.join('; ')}`,
  });
}

/**
 * Convert a Zod schema to the ToolSchema contract for ChatProvider.
 * @param name - Tool name
 * @param description - Tool description
 * @param schema - Zod schema object
 * @returns ToolSchema compatible with ChatProvider
 */
export function toolSchemaToProvider(
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>
): ToolSchema {
  return {
    name,
    description,
    parameters: zodToJsonSchema(schema),
  };
}
