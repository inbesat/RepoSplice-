import { describe, it, expect } from 'vitest';
import { ConfigSchema, defaultConfig, loadConfig } from './schema.js';

const validPatConfig = {
  github: { authType: 'pat' as const, token: 'ghp_test' },
  openrouter: { apiKey: 'sk-or-test' },
  anthropic: {},
  ollama: {},
  sandbox: {
    backend: 'docker' as const,
    limits: { memory: '2g', cpu: '1', timeout: 600 },
  },
  paths: { cacheDir: '.cache', worktreeDir: '.wt' },
  licensePolicy: { allow: ['MIT'], warn: ['GPL-2.0'], deny: [] },
  autonomy: { auto: ['fetch'], gated: ['merge'] },
};

const validAppConfig = {
  ...validPatConfig,
  github: {
    authType: 'app' as const,
    appId: 12345,
    privateKeyPath: '/secrets/key.pem',
    installationId: 67890,
  },
};

describe('ConfigSchema', () => {
  it('parses a valid PAT config', () => {
    const parsed = ConfigSchema.parse(validPatConfig);
    expect(parsed.github.authType).toBe('pat');
    expect(parsed.github.token).toBe('ghp_test');
    expect(parsed.sandbox.backend).toBe('docker');
    expect(parsed.licensePolicy.allow).toEqual(['MIT']);
  });

  it('parses a valid GitHub App config (all 3 fields present)', () => {
    const parsed = ConfigSchema.parse(validAppConfig);
    expect(parsed.github.authType).toBe('app');
    expect(parsed.github.appId).toBe(12345);
    expect(parsed.github.privateKeyPath).toBe('/secrets/key.pem');
    expect(parsed.github.installationId).toBe(67890);
  });

  it('rejects PAT config without token (via loadConfig)', () => {
    expect(() => loadConfig({ cli: { github: { authType: 'pat' } } })).toThrow(
      /authType='pat' requires a token/
    );
  });

  it('rejects App config missing one of the required fields (via loadConfig)', () => {
    expect(() =>
      loadConfig({
        file: { github: { authType: 'app', appId: 1, installationId: 2 } },
      })
    ).toThrow(/authType='app' requires privateKeyPath/);
  });

  it('rejects unknown authType (schema-level)', () => {
    const bad = { ...validPatConfig, github: { authType: 'oauth' } };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects unknown sandbox backend', () => {
    const bad = {
      ...validPatConfig,
      sandbox: { ...validPatConfig.sandbox, backend: 'k8s' },
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects invalid timeout (zero)', () => {
    const bad = {
      ...validPatConfig,
      sandbox: {
        ...validPatConfig.sandbox,
        limits: { ...validPatConfig.sandbox.limits, timeout: 0 },
      },
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects invalid ollama baseUrl', () => {
    const bad = { ...validPatConfig, ollama: { baseUrl: 'not-a-url' } };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects empty cacheDir', () => {
    const bad = { ...validPatConfig, paths: { cacheDir: '', worktreeDir: '.wt' } };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('error paths mention the failing field (schema-level)', () => {
    const result = ConfigSchema.safeParse({ ...validPatConfig, github: { authType: 'oauth' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = result.error.flatten();
      expect(JSON.stringify(flat)).toMatch(/github/);
    }
  });
});

describe('defaultConfig', () => {
  it('parses against ConfigSchema', () => {
    expect(() => ConfigSchema.parse(defaultConfig)).not.toThrow();
  });

  it('has docker backend by default', () => {
    expect(defaultConfig.sandbox.backend).toBe('docker');
  });

  it('has empty allow/warn/deny by default', () => {
    expect(defaultConfig.licensePolicy).toEqual({ allow: [], warn: [], deny: [] });
  });
});

describe('loadConfig merge precedence', () => {
  it('returns defaults when no layers provided (with token)', () => {
    const cfg = loadConfig({ file: { github: { token: 'ghp_x' } } });
    expect(cfg.sandbox.backend).toBe('docker');
    expect(cfg.paths.cacheDir).toBe('.repo-stitcher/cache');
    expect(cfg.github.token).toBe('ghp_x');
  });

  it('file layer overrides defaults', () => {
    const cfg = loadConfig({
      file: { github: { token: 'ghp_x' }, paths: { cacheDir: '/var/cache' } },
    });
    expect(cfg.paths.cacheDir).toBe('/var/cache');
    expect(cfg.paths.worktreeDir).toBe('.repo-stitcher/worktrees');
  });

  it('env layer overrides file layer', () => {
    const cfg = loadConfig({
      file: { github: { token: 'ghp_x' }, paths: { cacheDir: '/file' } },
      env: { paths: { cacheDir: '/env' } },
    });
    expect(cfg.paths.cacheDir).toBe('/env');
  });

  it('cli layer overrides env layer (highest precedence)', () => {
    const cfg = loadConfig({
      defaults: { paths: { cacheDir: '/defaults' } },
      file: { github: { token: 'x' }, paths: { cacheDir: '/file' } },
      env: { paths: { cacheDir: '/env' } },
      cli: { paths: { cacheDir: '/cli' } },
    });
    expect(cfg.paths.cacheDir).toBe('/cli');
  });

  it('deeper overrides do not clobber siblings (deep merge)', () => {
    const cfg = loadConfig({
      defaults: {
        github: { token: 'x' },
        sandbox: { backend: 'docker', limits: { memory: '2g', cpu: '1', timeout: 600 } },
      },
      file: { sandbox: { limits: { memory: '8g' } } },
    });
    expect(cfg.sandbox.backend).toBe('docker');
    expect(cfg.sandbox.limits.memory).toBe('8g');
    expect(cfg.sandbox.limits.cpu).toBe('1');
    expect(cfg.sandbox.limits.timeout).toBe(600);
  });

  it('CLI override of authType to app is reflected in the parsed result', () => {
    const cfg = loadConfig({
      defaults: defaultConfig,
      file: { github: { authType: 'pat', token: 'ghp_x' } },
      cli: { github: { authType: 'app', appId: 1, privateKeyPath: '/k', installationId: 2 } },
    });
    expect(cfg.github.authType).toBe('app');
  });

  it('invalid final config throws with a github-credentials error', () => {
    expect(() => loadConfig({ cli: { github: { authType: 'pat' } } })).toThrow(/github/i);
  });
});
