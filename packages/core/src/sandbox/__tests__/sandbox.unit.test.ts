// P-180 — the offline sandbox unit suite.
//
// One file that drives the WHOLE epic end to end with fakes, then proves each
// module's contract still holds, then proves the coverage gate exists. Every
// assertion here runs with no daemon, no network, and no container: the fake is
// at the SEAM (`DockerLike`), which is the only place a fake can be, because
// `SandboxClient` is nominally typed (ADR-030).
//
// The three scenarios this file owns (the phase's first, second and fourth
// required tests):
//
//   it('runs full sandbox flow with fake')   it('covers each module')
//   it('coverage gate')
//
// The fourth (`docker integration (gated)`) lives in `sandbox.docker.test.ts`,
// because it is the one suite that must NOT run offline.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok } from 'neverthrow';
import { FakeDockerode, FakeOctokit, makeDbAdapter } from './fake-docker.js';
import { pingDocker } from '../docker.js';
import { parseDockerEngineVersion } from '../dockerProbe.js';
import { SandboxClient, demuxDockerLogs } from '../client.js';
import { ensureImage, imageFor, isEphemeralTag, clearImageCacheForTests } from '../images.js';
import { installDeps, countInstalled } from '../install.js';
import { runBuild, boundLogLines } from '../build.js';
import { runTests, parseTestOutput } from '../test.js';
import { CaptureManager, sanitizeSegment } from '../capture.js';
import { DEFAULT_LIMITS, applyLimits, defaultLimits } from '../limits.js';
import { assessVerdict, resolveRepeat } from '../verdict.js';
import { CleanupTracker, cleanupSandbox } from '../cleanup.js';
import { SandboxCache, cacheKey, clearCacheForTests } from '../cache.js';
import { isSecretKey, safeEnvPlan } from '../secrets.js';
import { fallbackSelection, renderWorkflow, runViaGitHubActions } from '../fallback.js';

let root: string;
let workspace: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'stitch-sandbox-unit-'));
  workspace = join(root, 'child');
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, 'package.json'), '{"name":"child"}\n', 'utf8');
  await writeFile(join(workspace, 'bun.lock'), 'lock-v1\n', 'utf8');
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('P-180 sandbox unit suite', () => {
  it('runs full sandbox flow with fake', async () => {
    const fake = new FakeDockerode({ script: { exitCode: 0, stdout: ['12 packages installed'] } });
    const db = makeDbAdapter();
    const client = new SandboxClient({ docker: fake });
    const captured: string[] = [];

    // 1. AVAILABILITY — the daemon answers, so the Docker path is usable.
    const reachability = await pingDocker(fake);
    expect(reachability.isOk()).toBe(true);
    if (reachability.isOk()) expect(reachability.value.reachable).toBe(true);
    await expect(client.isAvailable()).resolves.toBe(true);

    // 2. IMAGE — resolved once, then served from the sqlite cache.
    clearImageCacheForTests();
    // The narrow `ImageClient` seam returns `Result`s; the adapter here mirrors
    // exactly what the production `SandboxClient` does over the same calls.
    const imageClient = {
      pull: async (image: string) => {
        await fake.pull(image);
        return ok(undefined);
      },
      buildImage: async () => ok(''),
    };
    const resolved = await ensureImage('node', imageClient, { db });
    expect(resolved.isOk()).toBe(true);
    if (resolved.isOk()) expect(resolved.value).toBe(imageFor('node'));
    expect(fake.pulled).toEqual([imageFor('node')]);

    // 3. INSTALL — a miss records the entry, and the SAME content then hits and
    //    creates no second container at all.
    const cache = new SandboxCache({ db, now: () => '2026-10-16T00:00:00.000Z' });
    const first = await installDeps('node', workspace, { cache }, client);
    expect(first.isOk()).toBe(true);
    const containersAfterInstall = fake.created.length;
    const second = await installDeps('node', workspace, { cache }, client);
    expect(second.isOk()).toBe(true);
    if (second.isOk()) {
      expect(second.value.cached).toBe(true);
      expect(second.value.installed).toBe(false);
    }
    expect(fake.created).toHaveLength(containersAfterInstall);

    // 4. BUILD — a passing build is `ok(pass: true)`.
    fake.script({ exitCode: 0, stdout: ['bundled 3 modules'] });
    const built = await runBuild('node', workspace, {}, client);
    expect(built.isOk()).toBe(true);
    if (built.isOk()) {
      expect(built.value.pass).toBe(true);
      expect(built.value.exitCode).toBe(0);
    }

    // 5. TEST — counts are parsed from the runner's own summary line.
    fake.script({ exitCode: 0, stdout: ['3 pass', '0 fail', '1 skip'] });
    const tested = await runTests('node', workspace, {}, client);
    expect(tested.isOk()).toBe(true);
    if (tested.isOk()) {
      expect(tested.value.pass).toBe(true);
      expect(tested.value.passed).toBe(3);
      expect(tested.value.failed).toBe(0);
      expect(tested.value.skipped).toBe(1);
    }

    // 6. CAPTURE — lines land in the bounded buffer, scrubbed at ingress.
    const manager = new CaptureManager({ secrets: ['topsecretvalue'] });
    const sink = manager.bindRun('flow-run');
    fake.script({ exitCode: 0, stdout: ['step one', 'leaked topsecretvalue', 'done'] });
    const ran = await client.run(
      { image: imageFor('node'), workingDir: '/workspace' },
      { onLog: line => sink.stream(line) }
    );
    expect(ran.isOk()).toBe(true);
    expect(manager.logs('flow-run')).toHaveLength(3);
    expect(manager.logs('flow-run')[1]).toContain('[REDACTED]');
    expect(manager.logs('flow-run')[1]).not.toContain('topsecretvalue');
    captured.push(...manager.logs('flow-run'));
    expect(captured).toHaveLength(3);

    // 7. LIMITS — the fallback profile applies to a spec.
    const limits = defaultLimits({});
    expect(limits.isOk()).toBe(true);
    if (limits.isOk()) {
      const limited = applyLimits(
        { image: imageFor('node'), workingDir: '/workspace' },
        limits.value
      );
      expect(limited.memory).toBe(limits.value.memMb * 1024 * 1024);
      expect(limited.cpus).toBe(limits.value.cpuCount);
    }

    // 8. FALLBACK — Docker is reachable, so the selection is the Docker path.
    expect(fallbackSelection({ dockerAvailable: true })).toBe('docker');

    // 9. VERDICT — a clean single run passes and is not flaky.
    const verdict = assessVerdict({
      pass: true,
      command: 'bun run build',
      exitCode: 0,
      durationMs: 5,
      logs: { stdout: [], stderr: [] },
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.flaky).toBe(false);
    expect(verdict.stableSince).toBe('first');

    // 10. CLEANUP — tracked resources are force-removed, and the run's
    //     container was already removed by `run`'s own `finally`.
    expect(fake.removed.length).toBeGreaterThan(0);
    const tracker = new CleanupTracker();
    tracker.track({ kind: 'container', id: 'flow-container' });
    const summary = await cleanupSandbox(
      {
        rm: async id => {
          fake.removed.push(typeof id === 'string' ? id : 'container-handle');
        },
      },
      tracker
    );
    expect(summary.removed.map(r => r.id)).toEqual(['flow-container']);
    expect(summary.errors).toEqual([]);

    // 11. CACHE — an in-memory round trip, and a content change is a new key.
    clearCacheForTests();
    const memory = new SandboxCache();
    const keyBefore = await cacheKey('node', workspace);
    await memory.put('node', workspace, { imageTag: 'stitch-node:x' });
    const lookup = await memory.get('node', workspace);
    expect(lookup.isOk() && lookup.value.hit).toBe(true);
    expect(lookup.isOk() && lookup.value.imageTag).toBe('stitch-node:x');
    await writeFile(join(workspace, 'bun.lock'), 'lock-v2\n', 'utf8');
    const keyAfter = await cacheKey('node', workspace);
    if (keyBefore.isOk() && keyAfter.isOk()) expect(keyAfter.value).not.toBe(keyBefore.value);
    const missed = await memory.get('node', workspace);
    expect(missed.isOk() && missed.value.hit).toBe(false);
    await writeFile(join(workspace, 'bun.lock'), 'lock-v1\n', 'utf8');

    // 12. SECRETS — the container would never have seen the host's token.
    const plan = safeEnvPlan({ PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_ABCDEFGHIJKLMNOPQRST' });
    expect(plan.env).toEqual({ PATH: '/usr/bin' });
    expect(plan.blocked).toEqual(['GITHUB_TOKEN']);

    // The GitHub path also dispatches offline, against a fake Octokit.
    const octokit = new FakeOctokit();
    const sha = 'a'.repeat(40);
    const dispatchedOnly = await runViaGitHubActions('node', workspace, 'build', {
      client: octokit,
      owner: 'acme',
      repo: 'child',
      sha,
      ref: 'main',
      jobId: 'job-1',
    });
    expect(octokit.dispatches).toHaveLength(1);
    // Dispatched, but nothing correlated: a typed error, never a manufactured
    // verdict. (The code is what P-095 actually returns when a dispatch has no
    // matching run — measured, not assumed.)
    expect(dispatchedOnly.isErr()).toBe(true);
    if (dispatchedOnly.isErr()) expect(dispatchedOnly.error.code).toBe('GITHUB_API_ERROR');

    // …and with a correlated run, the same fake drives a real verdict.
    octokit.runs = [
      {
        id: 42,
        head_sha: sha,
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://example.test/run/42',
      },
    ];
    const viaGitHub = await runViaGitHubActions('node', workspace, 'build', {
      client: octokit,
      owner: 'acme',
      repo: 'child',
      sha,
      ref: 'main',
      jobId: 'job-1',
    });
    expect(viaGitHub.isOk()).toBe(true);
    if (viaGitHub.isOk()) {
      expect(viaGitHub.value.pass).toBe(true);
      expect(viaGitHub.value.exitCode).toBe(0);
    }
  }, 120_000);

  it('covers each module', async () => {
    // client — Docker's multiplexed framing splits into stdout/stderr.
    const frame = (stream: number, text: string): Buffer => {
      const payload = Buffer.from(text, 'utf8');
      const header = Buffer.alloc(8);
      header[0] = stream;
      header.writeUInt32BE(payload.length, 4);
      return Buffer.concat([header, payload]);
    };
    const demuxed = demuxDockerLogs(Buffer.concat([frame(1, 'out\n'), frame(2, 'err\n')]));
    expect(demuxed.stdout).toEqual(['out']);
    expect(demuxed.stderr).toEqual(['err']);

    // docker / dockerProbe — reachability and the engine version parse.
    const fake = new FakeDockerode();
    expect((await pingDocker(fake)).isOk()).toBe(true);
    fake.failPing();
    const unreachable = await pingDocker(fake);
    if (unreachable.isOk()) expect(unreachable.value.reachable).toBe(false);
    expect(parseDockerEngineVersion('Docker version 27.3.1, build abc')).toBe('27.3.1');

    // images — the pinned tag and the ephemeral marker.
    expect(imageFor('python')).toBe('python:3.12-slim');
    expect(isEphemeralTag('stitch-node:stitch-ephemeral-abc')).toBe(true);
    expect(isEphemeralTag('oven/bun:1.1')).toBe(false);

    // install — the installed-count parser.
    expect(countInstalled('node', ['12 packages installed'])).toBe(12);
    expect(countInstalled('rust', ['Downloaded 4 crates'])).toBe(4);

    // build — the log bound keeps the NEWEST lines.
    expect(boundLogLines(['a', 'b', 'c'], 2)).toEqual(['b', 'c']);

    // test — the output parser reads counts and failures.
    const parsed = parseTestOutput('node', ['2 pass', '1 fail']);
    expect(parsed.passed).toBe(2);
    expect(parsed.failed).toBe(1);

    // capture — traversal is refused, not sanitised into something usable.
    const traversal = sanitizeSegment('../etc');
    expect(traversal.isErr()).toBe(true);
    expect(sanitizeSegment('dist').isOk()).toBe(true);

    // limits — the default profile is complete and well-ordered.
    expect(DEFAULT_LIMITS.memMb).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.cpuCount).toBeGreaterThan(0);

    // verdict — the repeat budget is clamped.
    expect(resolveRepeat({ repeat: 99 })).toBe(3);
    expect(resolveRepeat({})).toBe(2);

    // cleanup — with no client, a tracked container is REPORTED, not dropped.
    const reported = await cleanupSandbox(
      undefined,
      (() => {
        const tracker = new CleanupTracker();
        tracker.track({ kind: 'container', id: 'c1' });
        return tracker;
      })()
    );
    expect(reported.errors).toHaveLength(1);
    expect(reported.removed).toEqual([]);

    // cache — the key is a content hash.
    const key = await cacheKey('node', workspace);
    expect(key.isOk()).toBe(true);
    if (key.isOk()) expect(key.value).toMatch(/^[0-9a-f]{64}$/);

    // secrets — the mandated regex plus the P-010 coverage it would miss.
    expect(isSecretKey('API_KEY')).toBe(true);
    expect(isSecretKey('cookie')).toBe(true);
    expect(isSecretKey('PATH')).toBe(false);

    // fallback — selection and the committed workflow template.
    expect(fallbackSelection({})).toBe('unavailable');
    expect(fallbackSelection({ dockerAvailable: true })).toBe('docker');
    expect(fallbackSelection({ ciConfigured: true, hasAuth: true })).toBe('github');
    const rendered = renderWorkflow('runs-on: ubuntu-latest\n# {{jobId}} {{ecosystem}}\n', {
      jobId: 'job-1',
      ecosystem: 'node',
      timeoutMinutes: 30,
    });
    expect(rendered.isOk()).toBe(true);
    if (rendered.isOk()) expect(rendered.value).toBe('runs-on: ubuntu-latest\n# job-1 node\n');
  });

  it('coverage gate', async () => {
    // The gate is the `test:sandbox` script itself: if someone drops the
    // thresholds, the phase's acceptance silently stops being enforced.
    const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url));
    const pkg: unknown = JSON.parse(await readFile(pkgPath, 'utf8'));
    const scripts =
      typeof pkg === 'object' && pkg !== null && 'scripts' in pkg
        ? (pkg.scripts as Record<string, string> | undefined)
        : undefined;
    const gate = scripts?.['test:sandbox'];
    expect(gate).toBeDefined();
    expect(gate).toContain('src/sandbox');
    // `bun test` cannot run in this repo (bunfig `preload`), so the script uses
    // the same vitest form as the four sibling coverage scripts.
    expect(gate).toContain('vitest run');
    expect(gate).toContain('--coverage');
    expect(gate).toContain('--coverage.thresholds.lines=80');
    expect(gate).toContain('--coverage.thresholds.branches=70');
    expect(gate).toContain('--coverage.thresholds.statements=80');
    expect(gate).toContain('--coverage.thresholds.functions=80');
    // Test files must not count toward their own coverage.
    expect(gate).toContain('**/*.test.ts');
    expect(gate).toContain('**/__tests__/**');
  });
});
