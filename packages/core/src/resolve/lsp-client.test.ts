// P-335 — the LSP client against a protocol-faithful STUB server (the
// mandated python ids drive the real server through the harness).

import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLspClient } from './lsp-client.js';
import type { LspClient } from './lsp-client.js';

const STUB = join(import.meta.dirname, '..', '__tests__', 'fixtures', 'lsp-stub-server.ts');

let client: LspClient | undefined;

function stubClient(requestTimeoutMs = 5_000): LspClient {
  const created = createLspClient({
    command: process.execPath,
    args: [STUB],
    requestTimeoutMs,
  });
  client = created;
  return created;
}

afterEach(async () => {
  if (client !== undefined) {
    await client.shutdown();
    client = undefined;
  }
});

describe('LSP client (P-335)', () => {
  it('initializes and negotiates the capabilities', async () => {
    const result = await stubClient().initialize();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const capabilities = result.value.capabilities as { definitionProvider?: boolean };
      expect(capabilities.definitionProvider).toBe(true);
      expect(result.value.serverInfo?.name).toBe('stitch-lsp-stub');
    }
  });

  it('correlates a request with its own response', async () => {
    const created = stubClient();
    const init = await created.initialize();
    expect(init.isOk()).toBe(true);
    const answer = await created.request<{ echo: number }>('echo', { value: 7 });
    expect(answer.isOk()).toBe(true);
    if (answer.isOk()) expect(answer.value.echo).toBe(7);
  });

  it('answers three concurrent requests with their own payloads', async () => {
    const created = stubClient();
    await created.initialize();
    const answers = await Promise.all(
      [1, 2, 3].map(value => created.request<{ echo: number }>('echo', { value }))
    );
    expect(answers.every(answer => answer.isOk())).toBe(true);
    const echoed = answers.map(answer => (answer.isOk() ? answer.value.echo : -1));
    expect(new Set(echoed).size).toBe(3);
  });

  it('fails a request that times out', async () => {
    const created = stubClient(300);
    await created.initialize();
    const answer = await created.request('slow');
    expect(answer.isErr()).toBe(true);
    if (answer.isErr()) {
      expect(answer.error.code).toBe('INTERNAL');
      expect('message' in answer.error ? answer.error.message : answer.error.code).toContain(
        'slow'
      );
    }
  });

  it('delivers a server notification to its handler', async () => {
    const created = stubClient();
    const seen: unknown[] = [];
    created.onNotification('window/logMessage', params => {
      seen.push(params);
    });
    await created.initialize();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(seen.length).toBeGreaterThan(0);
  });

  it('ignores a response with an unknown id', async () => {
    const created = stubClient(300);
    await created.initialize();
    // The server answers a DIFFERENT id: our request is never answered, so it
    // times out - and the stray response must not disturb the next request.
    const stray = await created.request('unknownId');
    expect(stray.isErr()).toBe(true);
    const answer = await created.request<{ echo: number }>('echo', { value: 5 });
    expect(answer.isOk()).toBe(true);
    if (answer.isOk()) expect(answer.value.echo).toBe(5);
  });

  it('stops the server process on shutdown', async () => {
    const created = stubClient();
    await created.initialize();
    const stopped = await created.shutdown();
    expect(stopped.isOk()).toBe(true);
    expect(created.isAlive()).toBe(false);
    client = undefined;
  });

  it('reports a server that cannot start as a configuration error', async () => {
    const missing = createLspClient({
      command: 'stitch-no-such-language-server-binary',
      args: ['--stdio'],
      requestTimeoutMs: 1_000,
    });
    const result = await missing.initialize();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('fails a request when the server is gone', async () => {
    const created = stubClient();
    await created.initialize();
    created.dispose();
    const answer = await created.request('echo', { value: 1 });
    expect(answer.isErr()).toBe(true);
  });
});
