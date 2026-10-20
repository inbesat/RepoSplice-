// P-225 — the settings surface's client contract.
//
// Serve today (P-193 app.ts) exposes ONLY GET /api/settings (the effective
// config, optional — null when unwired). PATCH is the spec's write path
// (P-200 writeConfig): the serve lane validates + persists the patch to the
// same stitch.toml the CLI edits, so CLI and web stay one config. Patch keys
// match core ConfigSchema where core has a field (openrouter.defaultModel,
// agent.maxTokens, licensePolicy, sandbox.limits); `appearance`/`network`
// are client-contract extensions for the serve lane (ADR-110).
//
// Provider-key status arrives as booleans ONLY ({openrouter: true}) — a
// masked `set`/`not set` is rendered, never a value (spec handoff).

import { describeFailure } from './repos.js';
import type {
  LicenseListName,
  SettingsData,
  SettingsPatch,
  ThemeChoice,
} from '@repo-stitcher/shared';

export type { LicenseListName, SettingsData, SettingsPatch, ThemeChoice };

export const PROVIDERS = ['openrouter', 'anthropic', 'ollama'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Local mirror of core ai/models.ts (P-135) curated ids, per provider. */
export const MODEL_OPTIONS: Readonly<Record<Provider, readonly string[]>> = {
  openrouter: [
    'openrouter/anthropic/claude-3.5-sonnet',
    'openrouter/openai/gpt-4o',
    'openrouter/google/gemini-2.5-pro',
  ],
  anthropic: ['anthropic/claude-3.5-sonnet'],
  ollama: [],
};

/** Effective settings as the web renders them. Optional fields default. */
/** Deep-partial patch body for PATCH /api/settings. */
type Body = {
  openrouter?: { defaultModel?: unknown };
  agent?: { maxTokens?: unknown };
  ai?: { stream?: unknown };
  appearance?: { theme?: unknown };
  licensePolicy?: { allow?: unknown; warn?: unknown; deny?: unknown };
  sandbox?: { limits?: { timeout?: unknown; memory?: unknown } };
  network?: { offline?: unknown };
  tour?: { dismissed?: unknown };
  i18n?: { locale?: unknown };
  keys?: Record<string, unknown>;
};

function list(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Tolerates an unwired serve (null body) by yielding an empty shape. */
export async function getSettings(): Promise<SettingsData> {
  const response = await fetch('/api/settings');
  if (!response.ok) throw new Error(await describeFailure(response));
  const raw = (await response.json()) as Body | null;
  if (raw === null || typeof raw !== 'object') return {};
  const keys: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(raw.keys ?? {})) {
    keys[name] = value === true;
  }
  const theme =
    typeof raw.appearance?.theme === 'string' ? (raw.appearance.theme as ThemeChoice) : undefined;
  return {
    ...(typeof raw.openrouter?.defaultModel === 'string'
      ? { model: raw.openrouter.defaultModel }
      : {}),
    ...(typeof raw.agent?.maxTokens === 'number' ? { maxTokens: raw.agent.maxTokens } : {}),
    ...(typeof raw.ai?.stream === 'boolean' ? { streaming: raw.ai.stream } : {}),
    ...(theme !== undefined ? { theme } : {}),
    ...(raw.licensePolicy !== undefined
      ? {
          licensePolicy: {
            allow: list(raw.licensePolicy.allow),
            warn: list(raw.licensePolicy.warn),
            deny: list(raw.licensePolicy.deny),
          },
        }
      : {}),
    ...(typeof raw.sandbox?.limits?.timeout === 'number'
      ? { timeoutSec: raw.sandbox.limits.timeout }
      : {}),
    ...(typeof raw.sandbox?.limits?.memory === 'string'
      ? { memory: raw.sandbox.limits.memory }
      : {}),
    ...(typeof raw.network?.offline === 'boolean' ? { offline: raw.network.offline } : {}),
    ...(typeof raw.i18n?.locale === 'string' ? { locale: raw.i18n.locale } : {}),
    ...(Object.keys(keys).length > 0 ? { keys } : {}),
  };
}

/** PATCH /api/settings — the serve lane persists the patch (P-200 writeConfig). */
export async function patchSettings(patch: SettingsPatch): Promise<void> {
  const response = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(await describeFailure(response));
}
