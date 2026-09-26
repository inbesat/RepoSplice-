import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { runToolLoop } from './loop.js';
import type { ChatProvider } from './provider.js';
import type { ChatResponse, ToolDefinition, LoopConfig, ToolCall } from './types.js';
import type { CostTracker } from './cost.js';
import { ok } from 'neverthrow';

// Helper to create a fake provider that plays back one ChatResponse[]
// script per chat() call (streamChat normalizes them into ReasoningChunks).
function createFakeProvider(script: ChatResponse[][]): ChatProvider {
  let callIndex = 0;
  return {
    name: 'fake',
    model: 'fake',
    provider: 'fake',
    id: 'fake',
    async *chat() {
      const responses = script[callIndex] ?? [];
      callIndex++;
      for (const response of responses) {
        yield response;
      }
    },
    countTokens: () => 0,
    isRetryable: () => false,
  };
}

describe('P-140 loop: tool execution', () => {
  it('executes tool calls and finishes', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call_1', name: 'get_file', arguments: { path: 'test.txt' } },
    ];
    const provider = createFakeProvider([
      [
        // First call: model requests a tool call
        {
          content: '',
          toolCalls: [toolCalls[0]!],
          finishReason: 'tool_calls',
          usage: { input: 100, output: 50, total: 150 },
        },
      ],
      [
        // Second call: model stops
        {
          content: 'Done',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 50, output: 10, total: 60 },
        },
      ],
    ]);

    const tool: ToolDefinition = {
      name: 'get_file',
      description: 'Read a file',
      schema: { path: z.string() },
      execute: vi.fn().mockResolvedValue(ok('file content')),
      autonomy: 'auto',
    };

    const config: LoopConfig = { maxIterations: 5 };
    const result = await runToolLoop(
      provider,
      [tool],
      [{ role: 'user', content: 'Read test.txt' }],
      config
    );

    expect(result.isOk()).toBe(true);
    const loopResult = result._unsafeUnwrap();
    expect(loopResult.finishReason).toBe('stop');
    expect(loopResult.iterations).toBe(2);
    expect(loopResult.toolCalls).toHaveLength(1);
    expect(loopResult.toolCalls[0]?.name).toBe('get_file');
    expect(loopResult.messages.length).toBeGreaterThanOrEqual(3); // user, assistant(tool_calls), tool, assistant
    expect(tool.execute).toHaveBeenCalledWith({ path: 'test.txt' }, expect.any(Object));
  });

  it('recovers from invalid args', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call_1', name: 'get_file', arguments: { wrong_field: 'test.txt' } }, // missing required 'path'
    ];
    const provider = createFakeProvider([
      [
        {
          content: '',
          toolCalls: [toolCalls[0]!],
          finishReason: 'tool_calls',
          usage: { input: 100, output: 50, total: 150 },
        },
      ],
      [
        {
          content: 'Got it',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 50, output: 10, total: 60 },
        },
      ],
    ]);

    const tool: ToolDefinition = {
      name: 'get_file',
      description: 'Read a file',
      schema: { path: z.string() },
      execute: vi.fn().mockResolvedValue(ok('file content')),
      autonomy: 'auto',
    };

    const config: LoopConfig = { maxIterations: 5 };
    const result = await runToolLoop(
      provider,
      [tool],
      [{ role: 'user', content: 'Read test.txt' }],
      config
    );

    expect(result.isOk()).toBe(true);
    const loopResult = result._unsafeUnwrap();
    expect(loopResult.finishReason).toBe('stop');
    expect(loopResult.iterations).toBe(2);
    // Tool should NOT have been called due to validation error
    expect(tool.execute).not.toHaveBeenCalled();
    // Tool message should contain validation error
    const toolMsg = loopResult.messages.find(m => m.role === 'tool' && m.toolCallId === 'call_1');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg!.content);
    expect(parsed.code).toBe('TOOL_ARGS_VALIDATION');
  });

  it('recovers from unknown tool', async () => {
    const toolCalls: ToolCall[] = [{ id: 'call_1', name: 'nonexistent_tool', arguments: {} }];
    const provider = createFakeProvider([
      [
        {
          content: '',
          toolCalls: [toolCalls[0]!],
          finishReason: 'tool_calls',
          usage: { input: 100, output: 50, total: 150 },
        },
      ],
      [
        {
          content: 'Okay',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 50, output: 10, total: 60 },
        },
      ],
    ]);

    const config: LoopConfig = { maxIterations: 5 };
    const result = await runToolLoop(
      provider,
      [],
      [{ role: 'user', content: 'Do something' }],
      config
    );

    expect(result.isOk()).toBe(true);
    const loopResult = result._unsafeUnwrap();
    expect(loopResult.finishReason).toBe('stop');
    expect(loopResult.iterations).toBe(2);
    // Tool message should contain UNKNOWN_TOOL error
    const toolMsg = loopResult.messages.find(m => m.role === 'tool' && m.toolCallId === 'call_1');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg!.content);
    expect(parsed.code).toBe('UNKNOWN_TOOL');
  });

  it('caps at max iterations', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call_1', name: 'get_file', arguments: { path: 'test.txt' } },
    ];
    // Provider always returns tool_calls (one script entry per iteration)
    const provider = createFakeProvider([
      [
        {
          content: '',
          toolCalls: [toolCalls[0]!],
          finishReason: 'tool_calls',
          usage: { input: 100, output: 50, total: 150 },
        },
      ],
      [
        {
          content: '',
          toolCalls: [toolCalls[0]!],
          finishReason: 'tool_calls',
          usage: { input: 100, output: 50, total: 150 },
        },
      ],
      [
        {
          content: '',
          toolCalls: [toolCalls[0]!],
          finishReason: 'tool_calls',
          usage: { input: 100, output: 50, total: 150 },
        },
      ],
    ]);

    const tool: ToolDefinition = {
      name: 'get_file',
      description: 'Read a file',
      schema: { path: z.string() },
      execute: vi.fn().mockResolvedValue(ok('file content')),
      autonomy: 'auto',
    };

    const config: LoopConfig = { maxIterations: 3 };
    const result = await runToolLoop(
      provider,
      [tool],
      [{ role: 'user', content: 'Read test.txt' }],
      config
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('LOOP_LIMIT');
  });

  it('tracks cost', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call_1', name: 'get_file', arguments: { path: 'test.txt' } },
    ];
    const provider = createFakeProvider([
      [
        {
          content: '',
          toolCalls: [toolCalls[0]!],
          finishReason: 'tool_calls',
          usage: { input: 1000, output: 500, total: 1500 },
        },
      ],
      [
        {
          content: 'Done',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 500, output: 100, total: 600 },
        },
      ],
    ]);

    const tool: ToolDefinition = {
      name: 'get_file',
      description: 'Read a file',
      schema: { path: z.string() },
      execute: vi.fn().mockResolvedValue(ok('file content')),
      autonomy: 'auto',
    };

    const costTracker = {
      add: vi.fn(),
      totalTokens: { input: 0, output: 0, total: 0 },
      totalCost: 0,
      calls: 0,
      reset: vi.fn(),
    };
    const config: LoopConfig = { maxIterations: 5, cost: costTracker as unknown as CostTracker };

    await runToolLoop(provider, [tool], [{ role: 'user', content: 'Read test.txt' }], config);

    expect(costTracker.add).toHaveBeenCalledTimes(2);
    expect(costTracker.add).toHaveBeenCalledWith({ input: 1000, output: 500, total: 1500 });
    expect(costTracker.add).toHaveBeenCalledWith({ input: 500, output: 100, total: 600 });
  });

  it('routes gated tools through approvalGate', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call_1', name: 'dangerous_tool', arguments: { action: 'delete' } },
    ];
    const provider = createFakeProvider([
      [
        {
          content: '',
          toolCalls: [toolCalls[0]!],
          finishReason: 'tool_calls',
          usage: { input: 100, output: 50, total: 150 },
        },
      ],
      [
        {
          content: 'Done',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 50, output: 10, total: 60 },
        },
      ],
    ]);

    const approvalGate = vi.fn().mockResolvedValue(false); // deny
    const tool: ToolDefinition = {
      name: 'dangerous_tool',
      description: 'Dangerous',
      schema: { action: z.string() },
      execute: vi.fn().mockResolvedValue(ok('done')),
      autonomy: 'gated',
    };

    const config: LoopConfig = { maxIterations: 5, approvalGate };
    const result = await runToolLoop(
      provider,
      [tool],
      [{ role: 'user', content: 'Do dangerous thing' }],
      config
    );

    expect(result.isOk()).toBe(true);
    const loopResult = result._unsafeUnwrap();
    expect(loopResult.finishReason).toBe('stop');
    expect(approvalGate).toHaveBeenCalledWith('dangerous_tool');
    expect(tool.execute).not.toHaveBeenCalled();
    // Tool message should contain TOOL_DENIED error
    const toolMsg = loopResult.messages.find(m => m.role === 'tool' && m.toolCallId === 'call_1');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg!.content);
    expect(parsed.code).toBe('TOOL_DENIED');
  });

  it('aborts on signal', async () => {
    const controller = new AbortController();
    const provider = createFakeProvider([
      [
        {
          content: 'Starting',
          toolCalls: [],
          finishReason: 'stop',
          usage: { input: 100, output: 50, total: 150 },
        },
      ],
    ]);

    const config: LoopConfig = { maxIterations: 5, signal: controller.signal };
    const promise = runToolLoop(provider, [], [{ role: 'user', content: 'Hi' }], config);

    // Abort immediately (runToolLoop is suspended on its first await)
    controller.abort();

    const result = await promise;
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('ABORTED');
  });
});
