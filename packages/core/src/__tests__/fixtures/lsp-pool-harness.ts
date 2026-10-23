// P-344 — the harness the mandated python ids drive.
//
// It measures the pool hermetically (the stub server injected through
// createClient) and then ATTEMPTS the real typescript-language-server for the
// record: a missing or misbehaving real server is reported, never fatal, and
// never silently turned into a zero.
//
// One line of output: `POOL {json}`

import { join } from 'node:path';
import { createLspClient, type LspClientOptions } from '../../resolve/lsp-client.js';
import { createLspPool, defaultServerSpecs } from '../../resolve/lsp-pool.js';
import type { Ecosystem } from '../../deps/ecosystem.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const STUB = join(
  REPO_ROOT,
  'packages',
  'core',
  'src',
  '__tests__',
  'fixtures',
  'lsp-stub-server.ts'
);

interface Spec {
  readonly command: string;
  readonly args?: readonly string[];
}

/** A pool over the hermetic stub — no real language server is needed. */
function stubPool(options: { idleTimeoutMs?: number } = {}) {
  return createLspPool({
    servers: { node: { command: process.execPath, args: [STUB] } },
    createClient: (_ecosystem: Ecosystem, spec: Spec) => {
      const clientOptions: LspClientOptions = {
        command: spec.command,
        autoReconnect: false,
        requestTimeoutMs: 2_000,
        ...(spec.args !== undefined ? { args: spec.args } : {}),
      };
      return createLspClient(clientOptions);
    },
    ...(options.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function measureStub(): Promise<Record<string, unknown>> {
  const pool = stubPool();
  try {
    const coldStart = Date.now();
    const first = await pool.getClient('node');
    const coldMs = Date.now() - coldStart;
    if (first.isErr()) {
      return { ok: false, detail: 'the stub server did not start' };
    }
    const secondStart = Date.now();
    const second = await pool.getClient('node');
    const secondClientMs = Date.now() - secondStart;
    const sameInstance = first.isOk() && second.isOk() && first.value === second.value;

    const warmStart = Date.now();
    const warm = await pool.request('node', 'echo', { value: 'warm' });
    const warmMs = Date.now() - warmStart;
    const stats = pool.stats();

    const live = await pool.healthCheck('node');
    const missing = await pool.healthCheck('go');
    if (first.isOk()) first.value.dispose();
    const dead = await pool.healthCheck('node');
    const recreated = await pool.getClient('node');

    return {
      ok: true,
      reuse: { created: stats.created, reused: stats.reused, sameInstance, secondClientMs },
      warm: {
        coldMs,
        warmMs,
        under200: warmMs < 200,
        samples: stats.warmLatencyMs.length,
        ok: warm.isOk(),
      },
      health: {
        live: live.isOk()
          ? { ok: true, present: live.value.present, healthy: live.value.healthy }
          : { ok: false },
        missing: missing.isOk()
          ? { ok: true, present: missing.value.present, healthy: missing.value.healthy }
          : { ok: false },
        dead: dead.isOk() ? { ok: true, healthy: dead.value.healthy } : { ok: false },
        recreated: recreated.isOk(),
      },
      createdAfterRecreate: pool.stats().created,
    };
  } finally {
    await pool.shutdownAll();
  }
}

async function measureIdle(): Promise<Record<string, unknown>> {
  const pool = stubPool({ idleTimeoutMs: 200 });
  try {
    const first = await pool.getClient('node');
    if (first.isErr()) return { ok: false, detail: 'the stub server did not start' };
    await sleep(700);
    const idleShutdowns = pool.stats().idleShutdowns;
    const second = await pool.getClient('node');
    return {
      ok: true,
      idleShutdowns,
      createdAfterExpiry: pool.stats().created,
      restarted: second.isOk(),
    };
  } finally {
    await pool.shutdownAll();
  }
}

/** Best effort: the real TypeScript server, when this machine has it. */
async function measureReal(): Promise<Record<string, unknown>> {
  const specs = defaultServerSpecs();
  if (specs.node === undefined) {
    return { ok: false, status: 'unavailable', reason: 'no node server spec' };
  }
  const pool = createLspPool({ servers: { node: specs.node } });
  try {
    const started = await pool.getClient('node');
    if (started.isErr()) {
      return { ok: false, status: 'error', reason: 'the language server did not start' };
    }
    const health = await pool.healthCheck('node');
    return {
      ok: true,
      healthy: health.isOk() ? health.value.healthy : false,
      created: pool.stats().created,
    };
  } finally {
    await pool.shutdownAll();
  }
}

const report = {
  mode: 'lsp-pool',
  stub: await measureStub(),
  idle: await measureIdle(),
  real: await measureReal(),
};

process.stdout.write(`POOL ${JSON.stringify(report)}\n`);
