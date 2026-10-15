// P-179 — secret-safe sandbox tests.
//
// The container client and the capture client are fakes, so no daemon is touched
// and nothing is read from the real host environment: the tests assert the POLICY
// (what would reach a container), the REDACTION (what a captured line contains),
// and the WARNING (what a suspicious artifact name produces).
//
// The six required scenarios from the phase spec:
//
//   it('blocks secret keys')          it('masks values')
//   it('allow-lists keys')            it('scrubs log text')
//   it('never passes host env wholesale')   it('warns on suspicious artifact name')

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ok } from 'neverthrow';
import {
  SECRET_KEY_PATTERN,
  isSecretKey,
  isSecretToken,
  loggerSensitiveFields,
  safeEnv,
  safeEnvPlan,
  scanArtifactFile,
  scanArtifactName,
  scrubSecrets,
  type SecretScanWarning,
} from './secrets.js';
import { CaptureManager, type CaptureClient } from './capture.js';
import {
  SandboxClient,
  type ContainerCreateOptionsLike,
  type ContainerLike,
  type DockerLike,
} from './client.js';

/** A docker fake that records what a container would have been created with. */
function makeFakeDocker(logText: string): {
  docker: DockerLike;
  created: ContainerCreateOptionsLike[];
} {
  const created: ContainerCreateOptionsLike[] = [];
  const container: ContainerLike = {
    id: 'container-1',
    start: async () => undefined,
    // `#waitForExit` reads the exit status off this object.
    wait: async () => ({ StatusCode: 0 }),
    // A raw (unframed) buffer: the demuxer treats it as all-stdout.
    logs: async () => Buffer.from(logText, 'utf8'),
    remove: async () => undefined,
    stats: async () => ({}),
    inspect: async () => ({}),
    getArchive: async () => Readable.from([]),
    followLogs: async () => Readable.from([]),
  };
  const docker: DockerLike = {
    ping: async () => 'OK',
    pull: async () => undefined,
    buildImage: async () => undefined,
    createContainer: async options => {
      created.push(options);
      return container;
    },
    getContainer: () => container,
    getImage: () => ({ remove: async () => undefined }),
    getVolume: () => ({ remove: async () => undefined }),
    getNetwork: () => ({ remove: async () => undefined }),
    pruneImages: async () => ({}),
  };
  return { docker, created };
}

/** A capture client whose `copyFrom` writes a real file, as docker would. */
function makeCaptureClient(files: Record<string, string>): CaptureClient {
  return {
    logs: async () => ok({ stdout: [], stderr: [] }),
    followLogs: async () => ok(Readable.from([])),
    copyFrom: async (_container, _path, dir) => {
      await mkdir(dir, { recursive: true });
      const entries = Object.entries(files);
      const first = entries[0];
      if (first === undefined) return ok(join(dir, 'empty'));
      const target = join(dir, first[0]);
      await writeFile(target, first[1], 'utf8');
      return ok(target);
    },
  };
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'stitch-secrets-'));
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('P-179 safeEnv', () => {
  it('blocks secret keys', () => {
    const plan = safeEnvPlan({
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghp_ABCDEFGHIJKLMNOPQRST',
      API_KEY: 'sk-live-1234',
      HOME: '/root',
    });

    // Non-secret variables survive; secret-keyed ones never reach the container.
    expect(plan.env).toEqual({ PATH: '/usr/bin', HOME: '/root' });
    expect([...plan.blocked].sort()).toEqual(['API_KEY', 'GITHUB_TOKEN']);
    expect(plan.secretValues).toHaveLength(2);
    expect(plan.masked).toEqual([]);

    // `safeEnv` is the same decision, projected to the mandated signature.
    expect(safeEnv({ GITHUB_TOKEN: 'ghp_x', PATH: '/bin' })).toEqual({ PATH: '/bin' });

    // The key vocabulary, including the `*_KEY` suffix and the P-010 coverage
    // the mandated regex alone would miss (`cookie`).
    expect(isSecretKey('GITHUB_TOKEN')).toBe(true);
    expect(isSecretKey('API_KEY')).toBe(true);
    expect(isSecretKey('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(isSecretKey('DB_PASSWORD')).toBe(true);
    expect(isSecretKey('MY_CREDENTIAL')).toBe(true);
    expect(isSecretKey('PRIVATE_KEY')).toBe(true);
    expect(isSecretKey('x-api-key')).toBe(true);
    expect(isSecretKey('cookie')).toBe(true);
    expect(isSecretKey('PATH')).toBe(false);
    expect(isSecretKey('NODE_ENV')).toBe(false);
  });

  it('masks values', () => {
    const plan = safeEnvPlan({ API_KEY: 'sk-live-1234', PATH: '/bin' }, 'mask');

    // The value IS injected (unlike `block`) — that is why the plan must also
    // report what to mask in the logs.
    expect(plan.env).toEqual({ API_KEY: 'sk-live-1234', PATH: '/bin' });
    expect(plan.masked).toEqual(['API_KEY']);
    expect(plan.blocked).toEqual([]);

    const line = scrubSecrets('using API_KEY=sk-live-1234 now', plan.secretValues);
    expect(line).toContain('[REDACTED]');
    expect(line).not.toContain('sk-live-1234');
  });

  it('allow-lists keys', () => {
    const raw = { PATH: '/bin', MY_TOKEN: 'tok-1', OTHER: 'x' };
    const plan = safeEnvPlan(raw, 'allow-list', { allowedEnv: ['PATH', 'MY_TOKEN'] });

    // Only named keys pass — the secret one because it was named explicitly.
    expect(plan.env).toEqual({ PATH: '/bin', MY_TOKEN: 'tok-1' });
    expect(plan.blocked).toEqual(['OTHER']);
    expect(plan.masked).toEqual(['MY_TOKEN']);

    // An absent allow-list is EMPTY, not "allow everything": it fails safe.
    const empty = safeEnvPlan(raw, 'allow-list');
    expect(empty.env).toEqual({});
    expect([...empty.blocked].sort()).toEqual(['MY_TOKEN', 'OTHER', 'PATH']);
  });
});

describe('P-179 scrubSecrets', () => {
  it('scrubs log text', () => {
    // 1. A known in-scope value, wherever it appears.
    expect(scrubSecrets('value is hunter2secret', ['hunter2secret'])).toContain('[REDACTED]');
    expect(scrubSecrets('value is hunter2secret', ['hunter2secret'])).not.toContain(
      'hunter2secret'
    );

    // 2. `KEY=value` / `key: value` pairs whose key is secret-keyed.
    expect(scrubSecrets('token=supersecretvalue', [])).toBe('token=[REDACTED]');
    expect(scrubSecrets('Authorization: Bearer abcdefgh1234', [])).toContain('[REDACTED]');
    expect(scrubSecrets('Authorization: Bearer abcdefgh1234', [])).not.toContain('abcdefgh1234');

    // 3. Credential shapes, via P-145's redactor.
    expect(scrubSecrets('leaked ghp_ABCDEFGHIJKLMNOPQRST', [])).toBe('leaked [REDACTED]');
    expect(scrubSecrets('key sk-abcdefgh12345', [])).toContain('[REDACTED]');

    // Longest value first, so a shorter value nested in a longer one cannot
    // leave a fragment behind.
    expect(scrubSecrets('abc123def', ['abc123def', 'abc123'])).toBe('[REDACTED]');

    // Prose is NOT mangled: the text test is segment-exact, unlike the env test.
    expect(scrubSecrets('monkey: business', [])).toBe('monkey: business');
    expect(scrubSecrets('authenticate: now', [])).toBe('authenticate: now');
    expect(isSecretToken('monkey')).toBe(false);
    expect(isSecretToken('authenticate')).toBe(false);
    expect(isSecretToken('API_KEY')).toBe(true);
    expect(isSecretToken('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(isSecretToken('privateKey')).toBe(true);

    // The asymmetry is deliberate and worth pinning: the ENV test over-approximates.
    expect(isSecretKey('monkey')).toBe(true);
    expect(isSecretToken('monkey')).toBe(false);

    // An empty list is a no-op, and an empty value must not redact everything.
    expect(scrubSecrets('nothing to do', [])).toBe('nothing to do');
    expect(scrubSecrets('nothing to do', [''])).toBe('nothing to do');
  });

  it('covers every logger redact field', () => {
    const fields = loggerSensitiveFields();
    expect(fields.length).toBeGreaterThan(0);

    // The drift guard: every field P-010's logger redacts must be recognised by
    // the sandbox's key test, so the two lists can never silently diverge.
    for (const field of fields) expect(isSecretKey(field)).toBe(true);

    // The concrete gap the mandated regex alone leaves open.
    expect(SECRET_KEY_PATTERN.test('cookie')).toBe(false);
    expect(isSecretKey('cookie')).toBe(true);
  });
});

describe('P-179 client wiring', () => {
  it('never passes host env wholesale', async () => {
    const { docker, created } = makeFakeDocker('build ok\n');
    const client = new SandboxClient({ docker });

    const result = await client.run({
      image: 'stitch-node:test',
      workingDir: '/workspace',
      env: { PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_ABCDEFGHIJKLMNOPQRST', NODE_ENV: 'test' },
    });

    expect(result.isOk()).toBe(true);
    const env = created[0]?.Env ?? [];
    // Exactly the sanitised spec env — no host variables were added, and no
    // secret-keyed variable survived.
    expect([...env].sort()).toEqual(['NODE_ENV=test', 'PATH=/usr/bin']);
    expect(env.some(entry => entry.startsWith('GITHUB_TOKEN='))).toBe(false);
  });

  it('scrubs the logs a run returns', async () => {
    // The container's own output contains the injected secret and a token shape.
    const { docker } = makeFakeDocker(['starting', 'using sk-live-abcdefg now', 'done'].join('\n'));
    const client = new SandboxClient({
      docker,
      envPolicy: 'mask',
      allowedEnv: ['API_KEY'],
    });

    const seen: string[] = [];
    const result = await client.run(
      { image: 'stitch-node:test', workingDir: '/workspace', env: { API_KEY: 'sk-live-abcdefg' } },
      { onLog: line => seen.push(line) }
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Both the returned lines and the streamed lines are scrubbed, and the
      // masked value was injected rather than dropped.
      expect(result.value.stdout.join('\n')).not.toContain('sk-live-abcdefg');
      expect(result.value.stdout.join('\n')).toContain('[REDACTED]');
    }
    expect(seen.join('\n')).not.toContain('sk-live-abcdefg');
    expect(seen).toHaveLength(3);
  });
});

describe('P-179 capture wiring', () => {
  it('scrubs captured logs at ingress', () => {
    const manager = new CaptureManager({ secrets: ['supersecretvalue'] });
    const sink = manager.bindRun('run-1');

    sink.stream('using supersecretvalue here');
    sink.stream('API_KEY=abcdef123456');
    sink.stream('ordinary diagnostic line');

    // Nothing unscrubbed is retained, and the timestamped entries agree.
    expect(manager.logs('run-1')[0]).not.toContain('supersecretvalue');
    expect(manager.logs('run-1')[0]).toContain('[REDACTED]');
    expect(manager.logs('run-1')[1]).toContain('[REDACTED]');
    expect(manager.logs('run-1')[1]).not.toContain('abcdef123456');
    expect(manager.entries('run-1')[0]?.line).not.toContain('supersecretvalue');
    expect(manager.logs('run-1')[2]).toBe('ordinary diagnostic line');

    // Per-run secrets are honoured too, and do not leak between runs.
    const other = manager.bindRun('run-2', ['per-run-secret']);
    other.stream('per-run-secret appears');
    expect(manager.logs('run-2')[0]).not.toContain('per-run-secret');
    expect(manager.logs('run-1')).toHaveLength(3);
  });

  it('warns on suspicious artifact name', async () => {
    // Names that are secret-bearing by convention.
    expect(scanArtifactName('id_rsa')?.reason).toBe('sensitive-filename');
    expect(scanArtifactName('.env')?.reason).toBe('sensitive-filename');
    expect(scanArtifactName('credentials.json')?.reason).toBe('sensitive-filename');
    // A secret-keyed token in the name itself.
    expect(scanArtifactName('API_KEY.txt')?.reason).toBe('secret-keyed-name');
    // A credential shape in the name.
    expect(scanArtifactName('ghp_ABCDEFGHIJKLMNOPQRST.log')?.reason).toBe('github-token-shape');
    // Benign names stay quiet.
    expect(scanArtifactName('bundle.js')).toBeUndefined();
    expect(scanArtifactName('node_modules')).toBeUndefined();

    // The warning carries a MASKED excerpt — it must never become the leak.
    const warning = scanArtifactName('ghp_ABCDEFGHIJKLMNOPQRST.log');
    expect(warning?.excerpt).toContain('[REDACTED]');
    expect(warning?.excerpt).not.toContain('ABCDEFGHIJKLMNOPQRST');

    // …and it is emitted through capture, with no signature change to
    // `extractArtifacts` and without failing the copy.
    const warnings: SecretScanWarning[] = [];
    const manager = new CaptureManager({ onWarning: w => warnings.push(w) });
    const hostDir = join(root, 'artifacts');
    const extracted = await manager.extractArtifacts(
      makeCaptureClient({ id_rsa: 'PRIVATE KEY' }),
      'run-a',
      'container-1',
      ['/out/id_rsa'],
      hostDir
    );

    expect(extracted.isOk()).toBe(true);
    expect(warnings.map(w => w.artifact)).toContain('id_rsa');
    expect(warnings[0]?.reason).toBe('sensitive-filename');
  });

  it('scans artifact content only when opted in', async () => {
    const client = makeCaptureClient({ 'build.tgz': 'contents token=sk-abcdefgh12345 end\n' });
    const hostDir = join(root, 'scan');

    // Default: NAME only. A secret in the bytes is not reported, because
    // reading 100 MB tars by default would be a memory hazard.
    const quiet: SecretScanWarning[] = [];
    const nameOnly = new CaptureManager({ onWarning: w => quiet.push(w) });
    const first = await nameOnly.extractArtifacts(
      client,
      'run-c',
      'container-1',
      ['/out/build.tgz'],
      hostDir
    );
    expect(first.isOk()).toBe(true);
    expect(quiet).toEqual([]);

    // Opt-in (`config.sandbox.secretScanArtifacts`): the bounded prefix is read.
    const loud: SecretScanWarning[] = [];
    const scanning = new CaptureManager({
      scanArtifactContent: true,
      onWarning: w => loud.push(w),
    });
    const second = await scanning.extractArtifacts(
      client,
      'run-d',
      'container-1',
      ['/out/build.tgz'],
      hostDir
    );
    expect(second.isOk()).toBe(true);
    expect(loud.length).toBeGreaterThan(0);
    expect(loud.some(w => w.excerpt.includes('[REDACTED]'))).toBe(true);
    for (const warning of loud) expect(warning.excerpt).not.toContain('sk-abcdefgh12345');
  });

  it('reads a bounded prefix and reports typed errors', async () => {
    // A blank path and a missing file are typed errors, never throws.
    const blank = await scanArtifactFile('   ');
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');

    const missing = await scanArtifactFile(join(root, 'does-not-exist.bin'));
    expect(missing.isErr()).toBe(true);
    if (missing.isErr()) expect(missing.error.code).toBe('INTERNAL');

    // A real leak in the prefix is found.
    const leak = join(root, 'leak.env');
    await writeFile(leak, 'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUV\n', 'utf8');
    const found = await scanArtifactFile(leak);
    expect(found.isOk()).toBe(true);
    if (found.isOk()) {
      expect(found.value.length).toBeGreaterThan(0);
      expect(found.value.some(w => w.reason === 'github-token-shape')).toBe(true);
      for (const warning of found.value) {
        expect(warning.excerpt).not.toContain('ABCDEFGHIJKLMNOPQRSTUV');
      }
    }

    // The bound is honoured: a secret beyond `maxBytes` is not read.
    const long = join(root, 'long.txt');
    await writeFile(long, `${'x'.repeat(200)}ghp_ABCDEFGHIJKLMNOPQRSTUV\n`, 'utf8');
    const bounded = await scanArtifactFile(long, { maxBytes: 32 });
    expect(bounded.isOk()).toBe(true);
    if (bounded.isOk()) expect(bounded.value).toEqual([]);
  });
});
