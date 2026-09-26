import { describe, it, expect } from 'vitest';
import { estimateWindowUsage, trimMessages, addRepoContext, manageContext } from './context.js';
import type { ContextBlock } from './context.js';
import type { ChatMessage, ModelSpec } from './types.js';

const mockModel: ModelSpec = {
  id: 'test/model',
  provider: 'test',
  contextWindow: 10000,
  supportsTools: true,
  toolCalling: 'allowed',
  maxOutput: 4096,
  cost: { input: 3.0, output: 15.0 },
  recommendedFor: ['test'],
};

const mockMessages: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello, how are you?' },
  { role: 'assistant', content: 'I am doing well, thank you for asking!' },
  { role: 'user', content: 'Can you help me with a task?' },
  { role: 'assistant', content: 'Of course! What do you need help with?' },
];

describe('P-142 context: estimateWindowUsage', () => {
  it('estimates tokens for messages', () => {
    const usage = estimateWindowUsage(mockMessages, mockModel, 0);
    expect(typeof usage).toBe('number');
    expect(usage).toBeGreaterThan(0);
  });

  it('includes tool schema overhead', () => {
    const usageNoTools = estimateWindowUsage(mockMessages, mockModel, 0);
    const usageWithTools = estimateWindowUsage(mockMessages, mockModel, 5);
    expect(usageWithTools).toBe(usageNoTools + 5 * 500);
  });
});

describe('P-142 context: trimMessages', () => {
  it('drops oldest non-system first', () => {
    // Create messages that exceed budget
    const longMessages: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'a'.repeat(2000) },
      { role: 'assistant', content: 'b'.repeat(2000) },
      { role: 'user', content: 'c'.repeat(2000) },
      { role: 'assistant', content: 'd'.repeat(2000) },
    ];
    const { messages, dropped } = trimMessages(longMessages, mockModel, { safetyFactor: 0.5 });

    expect(dropped).toBeGreaterThan(0);
    // System message should be preserved
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toBe('System prompt');
    // Remaining messages should fit budget
    const usage = estimateWindowUsage(messages, mockModel);
    const budget = Math.floor(mockModel.contextWindow * 0.5) - mockModel.maxOutput;
    expect(usage).toBeLessThanOrEqual(budget);
  });

  it('truncates oversized message', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'x'.repeat(10000) }, // Very long message
    ];
    const { messages: trimmed } = trimMessages(messages, mockModel, { safetyFactor: 0.65 });

    // Should have truncated the long message
    const userMsg = trimmed.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain('[truncated]');
    expect(userMsg!.content.length).toBeLessThan(10000);
  });

  it('fits under budget', () => {
    const longMessages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'a'.repeat(1500) },
      { role: 'assistant', content: 'b'.repeat(1500) },
      { role: 'user', content: 'c'.repeat(1500) },
    ];
    const { messages } = trimMessages(longMessages, mockModel, { safetyFactor: 0.8 });

    const usage = estimateWindowUsage(messages, mockModel);
    const budget = Math.floor(mockModel.contextWindow * 0.8) - mockModel.maxOutput;
    expect(usage).toBeLessThanOrEqual(budget);
  });

  it('reports dropped count', () => {
    let droppedCount = 0;
    const longMessages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'a'.repeat(2000) },
      { role: 'assistant', content: 'b'.repeat(2000) },
      { role: 'user', content: 'c'.repeat(2000) },
    ];
    trimMessages(longMessages, mockModel, {
      safetyFactor: 0.5,
      onContextTrim: dropped => {
        droppedCount = dropped;
      },
    });

    expect(droppedCount).toBeGreaterThan(0);
  });
});

describe('P-142 context: addRepoContext', () => {
  it('prioritizes repo context blocks', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Task' },
    ];
    const blocks: ContextBlock[] = [
      { priority: 1, label: 'low', content: 'x'.repeat(2000) },
      { priority: 10, label: 'high', content: 'y'.repeat(500) },
      { priority: 5, label: 'medium', content: 'z'.repeat(1000) },
    ];

    const result = addRepoContext(messages, blocks, mockModel, { safetyFactor: 0.8 });

    // Should have added high and medium priority blocks
    const contextMsgs = result.filter(m => m.content.includes('[Context:'));
    expect(contextMsgs.length).toBeGreaterThanOrEqual(1);
    // High priority should be included
    expect(contextMsgs.some(m => m.content.includes('high'))).toBe(true);
  });

  it('respects budget and drops low priority', () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'System' }];
    const blocks: ContextBlock[] = [
      { priority: 1, label: 'low', content: 'x'.repeat(5000) },
      { priority: 10, label: 'high', content: 'y'.repeat(500) },
    ];
    // Very tight budget
    const result = addRepoContext(messages, blocks, mockModel, { safetyFactor: 0.5 });

    const contextMsgs = result.filter(m => m.content.includes('[Context:'));
    // Only high priority should fit
    expect(contextMsgs.length).toBe(1);
    expect(contextMsgs[0]?.content).toContain('high');
  });
});

describe('P-142 context: manageContext', () => {
  it('trims and adds repo context', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'a'.repeat(3000) },
      { role: 'assistant', content: 'b'.repeat(3000) },
    ];
    const blocks: ContextBlock[] = [{ priority: 10, label: 'diff', content: 'diff content' }];
    let droppedCount = 0;

    const result = await manageContext({}, messages, {
      model: mockModel,
      repoContext: blocks,
      safetyFactor: 0.5,
      onContextTrim: d => {
        droppedCount = d;
      },
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.role).toBe('system');
    expect(droppedCount).toBeGreaterThan(0);
    const usage = estimateWindowUsage(result, mockModel);
    const budget = Math.floor(mockModel.contextWindow * 0.5) - mockModel.maxOutput;
    expect(usage).toBeLessThanOrEqual(budget);
  });
});
