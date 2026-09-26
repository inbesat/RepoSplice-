import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema, parseToolArgs, toolSchemaToProvider } from './toolAdapter.js';
import { stitchErrorMessage } from '../result/index.js';

describe('P-139 toolAdapter: zod to JSON schema', () => {
  it('converts zod to json schema', () => {
    const schema = { foo: z.string(), bar: z.number().optional() };
    const jsonSchema = zodToJsonSchema(schema);

    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.required).toContain('foo');
    expect(jsonSchema.required).not.toContain('bar');
    expect(jsonSchema.properties).toBeDefined();
    expect((jsonSchema.properties as Record<string, unknown>).foo).toEqual({ type: 'string' });
  });

  it('handles complex types', () => {
    const schema = {
      items: z.array(z.string()),
      nested: z.object({ a: z.number() }),
      enum: z.enum(['a', 'b']),
    };
    const jsonSchema = zodToJsonSchema(schema);
    expect(jsonSchema.type).toBe('object');
    const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.items?.type).toBe('array');
    expect(props.nested?.type).toBe('object');
    expect(props.enum?.enum).toEqual(['a', 'b']);
  });
});

describe('P-139 toolAdapter: parseToolArgs', () => {
  const schema = { name: z.string(), count: z.number().int().positive() };

  it('parses valid object args', () => {
    const result = parseToolArgs(schema, { name: 'test', count: 5 });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ name: 'test', count: 5 });
  });

  it('parses string args', () => {
    const result = parseToolArgs(schema, '{"name": "test", "count": 5}');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ name: 'test', count: 5 });
  });

  it('rejects invalid json', () => {
    const result = parseToolArgs(schema, '{not valid json}');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('TOOL_ARGS_INVALID_JSON');
  });

  it('reports validation issues', () => {
    // Missing required field
    const result = parseToolArgs(schema, { count: 5 });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('TOOL_ARGS_VALIDATION');
    expect(stitchErrorMessage(result._unsafeUnwrapErr())).toContain('/name');

    // Wrong type
    const result2 = parseToolArgs(schema, { name: 'test', count: 'not a number' });
    expect(result2.isErr()).toBe(true);
    expect(result2._unsafeUnwrapErr().code).toBe('TOOL_ARGS_VALIDATION');
    expect(stitchErrorMessage(result2._unsafeUnwrapErr())).toContain('/count');
  });

  it('strips unknown in strict mode', () => {
    // strict:true → strips unknown keys and succeeds
    const resultStrict = parseToolArgs(schema, { name: 'test', count: 5, extra: 'ignored' }, true);
    expect(resultStrict.isOk()).toBe(true);
    expect(resultStrict._unsafeUnwrap()).toEqual({ name: 'test', count: 5 });
    expect(resultStrict._unsafeUnwrap()).not.toHaveProperty('extra');

    // strict:false (default) fails on unknown keys
    const resultLoose = parseToolArgs(schema, { name: 'test', count: 5, extra: 'ignored' }, false);
    expect(resultLoose.isErr()).toBe(true);
    expect(resultLoose._unsafeUnwrapErr().code).toBe('TOOL_ARGS_VALIDATION');
  });
});

describe('P-139 toolAdapter: toolSchemaToProvider', () => {
  it('produces ToolSchema contract', () => {
    const schema = { input: z.string(), limit: z.number().optional() };
    const toolSchema = toolSchemaToProvider('my_tool', 'Description', schema);

    expect(toolSchema.name).toBe('my_tool');
    expect(toolSchema.description).toBe('Description');
    expect(toolSchema.parameters.type).toBe('object');
    expect(toolSchema.parameters.required).toContain('input');
    expect(toolSchema.parameters.required).not.toContain('limit');
  });
});
