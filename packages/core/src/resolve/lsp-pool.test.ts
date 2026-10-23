// P-344 — the warm-pool contract, exercised hermetically over the STUB server.
//
// The pool's job is to stop paying the server's boot cost per call. These
// cases inject the stub server (the real one is covered by the python harness,
// which also attempts typescript-language-server), so they are deterministic:
// one spawn, a reuse, a shutdown after the idle window, a queue at the
// concurrency cap, and a health ping that treats an error RESPONSE as proof
// the pipe is alive.

import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLspPool, LSPPool } from './lsp-pool.js';
import type { LspClient, LspClientOptions } from './lsp-client.js';
import { createLspClient } from './lsp-client.js';
import type { Ecosystem } from '../deps/ecosystem.js';

const STUB = join(import.meta.dirname, '..', '__tests__', 'fixtures', 'lsp-stub-server.ts');

/** A pool whose one configured server is the hermetic stub. */
function poolWith(
  options: { idleTimeoutMs?: number; maxConcurrentRequests?: number } = {}
): LSPPool {
  return createLspPool({
    servers: { node: { command: process.execPath, args: [STUB] } },
    createClient: (_ecosystem: Ecosystem, spec: { command: string; args?: readonly string[] }) => {
      const clientOptions: LspClientOptions = {
        command: spec.command,
        autoReconnect: false,
        requestTimeoutMs: 2_000,
        ...(spec.args !== undefined ? { args: spec.args } : {}),
      };
      return createLspClient(clientOptions);
    },
    ...(options.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
    ...(options.maxConcurrentRequests !== undefined
      ? { maxConcurrentRequests: options.maxConcurrentRequests }
      : {}),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('LSPPool (P-344)', () => {
  let pool: LSPPool | undefined;

  afterEach(async () => {
    if (pool !== undefined) {
      await pool.shutdownAll();
      pool = undefined;
    }
  });

  it('starts one server per ecosystem and reuses it', async () => {
    pool = poolWith();
    const first = await pool.getClient('node');
    expect(first.isOk()).toBe(true);
    const second = await pool.getClient('node');
    expect(second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) {
      expect(second.value).toBe(first.value);
    }
    const stats = pool.stats();
    expect(stats.created).toBe(1);
    expect(stats.reused).toBeGreaterThanOrEqual(1);
  });

  it('reports an ecosystem with no configured server', async () => {
    pool = poolWith();
    const missing = await pool.getClient('go');
    expect(missing.isErr()).toBe(true);
    if (missing.isErr()) {
      expect(missing.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('shuts an idle server down', async () => {
    pool = poolWith({ idleTimeoutMs: 150 });
    const first = await pool.getClient('node');
    expect(first.isOk()).toBe(true);
    await sleep(500);
    expect(pool.stats().idleShutdowns).toBe(1);
    const second = await pool.getClient('node');
    expect(second.isOk()).toBe(true);
    expect(pool.stats().created).toBe(2);
  });

  it('queues requests at the concurrency cap', async () => {
    pool = poolWith({ maxConcurrentRequests: 2 });
    await pool.getClient('node');
    const answers = await Promise.all([
      pool.request('node', 'echo', { value: 1 }),
      pool.request('node', 'echo', { value: 2 }),
      pool.request('node', 'echo', { value: 3 }),
      pool.request('node', 'echo', { value: 4 }),
    ]);
    expect(answers.every(answer => answer.isOk())).toBe(true);
    expect(pool.stats().peakConcurrentRequests).toBeLessThanOrEqual(2);
  });

  it('checks the health of a live and an absent server', async () => {
    pool = poolWith();
    const live = await pool.healthCheck('node');
    expect(live.isOk()).toBe(true);
    if (live.isOk()) {
      expect(live.value.present).toBe(false);
      expect(live.value.healthy).toBe(false);
    }
    const started = await pool.getClient('node');
    expect(started.isOk()).toBe(true);
    const healthy = await pool.healthCheck('node');
    expect(healthy.isOk()).toBe(true);
    if (healthy.isOk()) {
      expect(healthy.value.healthy).toBe(true);
      expect(healthy.value.present).toBe(true);
    }
    const missing = await pool.healthCheck('rust');
    if (missing.isOk()) {
      expect(missing.value.present).toBe(false);
    }
  });

  it('replaces a server whose process died', async () => {
    pool = poolWith();
    const first = await pool.getClient('node');
    expect(first.isOk()).toBe(true);
    if (first.isOk()) {
      const client: LspClient = first.value;
      client.dispose();
    }
    const health = await pool.healthCheck('node');
    expect(health.isOk()).toBe(true);
    if (health.isOk()) {
      expect(health.value.healthy).toBe(false);
    }
    const second = await pool.getClient('node');
    expect(second.isOk()).toBe(true);
    expect(pool.stats().created).toBe(2);
  });

  it('keeps warm requests under the 200ms bar', async () => {
    pool = poolWith();
    const startedAt = Date.now();
    const first = await pool.getClient('node');
    const coldMs = Date.now() - startedAt;
    expect(first.isOk()).toBe(true);
    const warmStart = Date.now();
    const warm = await pool.request('node', 'echo', { value: 'warm' });
    const warmMs = Date.now() - warmStart;
    expect(warm.isOk()).toBe(true);
    expect(warmMs).toBeLessThan(200);
    expect(warmMs).toBeLessThan(Math.max(coldMs, 1));
    expect(pool.stats().warmLatencyMs.length).toBeGreaterThanOrEqual(1);
  });
});
