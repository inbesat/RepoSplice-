import { toJSONSchema } from 'zod';
import { ConfigSchema } from './schema.js';

/**
 * configJsonSchema: emit the ConfigSchema (P-009) as JSON Schema
 * (draft 2020-12) for editor tooling, docs, and REST/GraphQL I/O
 * validation (P-297/298). AI tool-argument shaping (P-139) can call
 * zod's native `toJSONSchema` on any schema the same way.
 *
 * Uses zod v4's native converter (ADR-017): the `zod-to-json-schema`
 * package does not support zod v4 schemas (returns just `$schema`),
 * while the native converter preserves enums, formats, and
 * required lists.
 */
export function configJsonSchema() {
  return toJSONSchema(ConfigSchema);
}
