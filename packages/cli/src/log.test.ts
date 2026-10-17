// P-206 — log filtering tests.
//
// The six required scenarios from the phase spec:
//
//   it('filters levels')   it('module filter')   it('redacts secrets')
//   it('silent mode')      it('json logs')       it('child modules')

import { describe, it, expect } from 'vitest';
import { createLogger, levelFor, parseLogFilter, type LogSink } from './log.js';

/** A capturing sink: every written line lands in `lines`, newline-trimmed. */
function capture(): LogSink & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => void lines.push(line.endsWith('\n') ? line.slice(0, -1) : line),
  };
}

describe('P-206 log', () => {
  it('filters levels', () => {
    const sink = capture();
    const log = createLogger({ level: 'info', sink });
    log.debug('quiet'); // below the threshold
    log.info('note');
    log.warn('careful');
    log.error('broken');
    expect(sink.lines).toHaveLength(3);
    expect(sink.lines[0]).toBe('note');
    expect(sink.lines[1]).toBe('warn: careful');
    expect(sink.lines[2]).toBe('error: broken');

    // `-V` maps to debug: the debug line now passes.
    expect(levelFor({ verbose: true })).toBe('debug');
    const verbose = capture();
    createLogger({ level: 'debug', sink: verbose }).debug('now visible');
    expect(verbose.lines).toEqual(['debug: now visible']);

    // `-q` maps to silent, and `-q` wins over `-V` when both are given.
    expect(levelFor({ quiet: true })).toBe('silent');
    expect(levelFor({ verbose: true, quiet: true })).toBe('silent');
  });

  it('module filter', () => {
    const parsed = parseLogFilter('deps=debug,sandbox=warn');
    expect(parsed.isOk()).toBe(true);
    if (!parsed.isOk()) return;
    const sink = capture();
    const log = createLogger({
      level: 'info',
      moduleFilter: parsed.value.modules,
      sink,
    });
    // `deps` is raised to debug; `sandbox` is lowered to warn; others follow info.
    log.child('deps').debug('dep detail');
    log.child('sandbox').debug('dropped');
    log.child('sandbox').warn('sandbox warn');
    log.child('agent').debug('dropped too');
    expect(sink.lines).toEqual(['[deps] debug: dep detail', '[sandbox] warn: sandbox warn']);

    // A bare default in the spec overrides the level argument, and an unknown
    // level is a config error.
    const bare = parseLogFilter('debug', 'info');
    expect(bare.isOk()).toBe(true);
    if (bare.isOk()) expect(bare.value.default).toBe('debug');
    const bad = parseLogFilter('deps=loud');
    expect(bad.isErr()).toBe(true);
    if (bad.isErr() && bad.error.code === 'CONFIG_ERROR') {
      expect(bad.error.field).toBe('log');
    }
  });

  it('redacts secrets', () => {
    const sink = capture();
    const log = createLogger({ level: 'info', sink });
    log.info('using OPENROUTER_API_KEY=sk-abc123 and password=hunter2');
    log.warn('Authorization: Bearer tok_999');
    const text = sink.lines.join('\n');
    expect(text).not.toContain('sk-abc123');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('tok_999');
    expect(text).toContain('***');
    // The KEYS stay readable — only the values are gone.
    expect(text).toContain('OPENROUTER_API_KEY');
    expect(text).toContain('password');

    // Caller-supplied config key names redact as well (P-200's key list seam).
    const custom = capture();
    createLogger({ level: 'info', sink: custom, redactKeys: ['stitch.pat'] }).info(
      'stitch.pat = very-hidden'
    );
    expect(custom.lines[0]).not.toContain('very-hidden');
    expect(custom.lines[0]).toContain('***');
  });

  it('silent mode', () => {
    const sink = capture();
    const log = createLogger({ level: 'silent', sink });
    log.trace('t');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('E — still shown');
    expect(sink.lines).toEqual(['error: E — still shown']);

    // `--quiet-error` seals even the error lane.
    const sealed = capture();
    createLogger({ level: 'silent', quietError: true, sink: sealed }).error('gone');
    expect(sealed.lines).toEqual([]);
  });

  it('json logs', () => {
    const sink = capture();
    const log = createLogger({ level: 'info', sink, json: true });
    log.child('deps').warn('api_key=zzz leaked?');
    expect(sink.lines).toHaveLength(1);
    const entry = JSON.parse(sink.lines[0] ?? '{}') as {
      ts: string;
      level: string;
      module?: string;
      msg: string;
    };
    // One JSON object per line, timestamped, namespaced — and REDACTED.
    expect(entry.level).toBe('warn');
    expect(entry.module).toBe('deps');
    expect(entry.msg).toBe('api_key=*** leaked?');
    expect(entry.ts).toEqual(expect.any(String));
  });

  it('child modules', () => {
    const sink = capture();
    const log = createLogger({ level: 'info', sink });
    log.child('deps').info('merging');
    log.child('deps').child('cache').info('hit');
    expect(sink.lines).toEqual(['[deps] merging', '[deps.cache] hit']);
    // A child's name rides the module field in JSON mode too.
    const jsonSink = capture();
    createLogger({ level: 'info', sink: jsonSink, json: true })
      .child('sandbox')
      .child('limits')
      .info('ok');
    const entry = JSON.parse(jsonSink.lines[0] ?? '{}') as { module?: string };
    expect(entry.module).toBe('sandbox.limits');
  });
});
