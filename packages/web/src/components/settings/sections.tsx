// P-225 — settings sections: pure presentational, value + onChange in, zero
// fetching (SettingsPage owns the draft, validation, and PATCH).

import type { JSX } from 'react';
import {
  MODEL_OPTIONS,
  PROVIDERS,
  type LicenseListName,
  type Provider,
  type ThemeChoice,
} from '../../api/settings.js';
import { SUPPORTED_LOCALES } from '../../i18n/index.js';

const OPTION_CLASS = 'text-body bg-bg border border-border rounded px-2 py-1';
const ROW_CLASS = 'flex items-center gap-2';

export interface SectionProps<T> {
  readonly value: T;
  readonly onChange: (next: T) => void;
}

/** AI: provider, model (P-135 registry mirror), streaming, token budget. */
export function AiSection({
  value,
  onChange,
}: SectionProps<{
  provider: Provider;
  model: string;
  streaming: boolean;
  maxTokens: number;
}>): JSX.Element {
  const options = MODEL_OPTIONS[value.provider] ?? [];
  const opt = (id: string): JSX.Element => (
    <option key={id} value={id}>
      {id}
    </option>
  );
  return (
    <fieldset aria-label="ai settings" className="flex flex-col gap-2">
      <legend className="text-title">AI</legend>
      <label className={ROW_CLASS}>
        provider
        <select
          aria-label="provider"
          className={OPTION_CLASS}
          value={value.provider}
          onChange={e => onChange({ ...value, provider: e.target.value as Provider })}
        >
          {PROVIDERS.map(p => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      {options.length > 0 ? (
        <label className={ROW_CLASS}>
          model
          <select
            aria-label="model"
            className={OPTION_CLASS}
            value={value.model}
            onChange={e => onChange({ ...value, model: e.target.value })}
          >
            {options.map(opt)}
          </select>
        </label>
      ) : (
        <p className="text-caption text-muted">model is configured via the CLI for this provider</p>
      )}
      <label className={ROW_CLASS}>
        <input
          type="checkbox"
          aria-label="streaming"
          checked={value.streaming}
          onChange={e => onChange({ ...value, streaming: e.target.checked })}
        />
        stream responses
      </label>
      <label className={ROW_CLASS}>
        max tokens
        <input
          type="number"
          aria-label="max tokens"
          className="w-24 text-body bg-bg border border-border rounded px-2 py-1"
          value={value.maxTokens}
          onChange={e => onChange({ ...value, maxTokens: Number(e.target.value) })}
        />
      </label>
    </fieldset>
  );
}

/** Licenses: default policy (client contract) + allow/warn/deny overrides. */
export function LicensesSection({
  value,
  onChange,
}: SectionProps<{
  policy: 'allow' | 'deny';
  allow: readonly string[];
  warn: readonly string[];
  deny: readonly string[];
}>): JSX.Element {
  const lists: readonly LicenseListName[] = ['allow', 'warn', 'deny'];
  return (
    <fieldset aria-label="license settings" className="flex flex-col gap-2">
      <legend className="text-title">Licenses</legend>
      <label className={ROW_CLASS}>
        default policy
        <select
          aria-label="license policy"
          className={OPTION_CLASS}
          value={value.policy}
          onChange={e => onChange({ ...value, policy: e.target.value as 'allow' | 'deny' })}
        >
          <option value="allow">allow</option>
          <option value="deny">deny</option>
        </select>
      </label>
      {lists.map(name => (
        <div key={name} className="flex flex-col gap-1">
          <span className="text-caption text-muted">{name}</span>
          <ul className="flex flex-wrap gap-1" aria-label={`${name} list`}>
            {value[name].map(id => (
              <li key={id} className="text-caption bg-surface rounded px-2 py-0.5">
                {id}
                <button
                  type="button"
                  aria-label={`remove ${id}`}
                  className="ml-1 text-danger"
                  onClick={() => onChange({ ...value, [name]: value[name].filter(v => v !== id) })}
                >
                  ×
                </button>
              </li>
            ))}
            {value[name].length === 0 && <li className="text-caption text-muted">none</li>}
          </ul>
          <input
            aria-label={`add ${name}`}
            placeholder={`add ${name} id…`}
            className="text-body bg-bg border border-border rounded px-2 py-1"
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              const id = e.currentTarget.value.trim();
              if (id === '' || value[name].includes(id)) return;
              onChange({ ...value, [name]: [...value[name], id] });
              e.currentTarget.value = '';
            }}
          />
        </div>
      ))}
    </fieldset>
  );
}

/** Sandbox: default timeout/memory + backend capability (fetched by the page). */
export function SandboxSection({
  value,
  onChange,
  capability,
}: SectionProps<{ timeoutSec: number; memory: string }> & {
  readonly capability: string;
}): JSX.Element {
  return (
    <fieldset aria-label="sandbox settings" className="flex flex-col gap-2">
      <legend className="text-title">Sandbox</legend>
      <p className="text-caption text-muted">backend: {capability}</p>
      <label className={ROW_CLASS}>
        timeout (s)
        <input
          type="number"
          aria-label="timeout"
          className="w-24 text-body bg-bg border border-border rounded px-2 py-1"
          value={value.timeoutSec}
          onChange={e => onChange({ ...value, timeoutSec: Number(e.target.value) })}
        />
      </label>
      <label className={ROW_CLASS}>
        memory
        <input
          aria-label="memory"
          placeholder="e.g. 2g"
          className="text-body bg-bg border border-border rounded px-2 py-1"
          value={value.memory}
          onChange={e => onChange({ ...value, memory: e.target.value })}
        />
      </label>
    </fieldset>
  );
}

/** Appearance: theme choice (P-226 persists + applies it globally). */
export function AppearanceSection({ value, onChange }: SectionProps<ThemeChoice>): JSX.Element {
  return (
    <fieldset aria-label="appearance settings" className="flex flex-col gap-2">
      <legend className="text-title">Appearance</legend>
      <label className={ROW_CLASS}>
        theme
        <select
          aria-label="theme"
          className={OPTION_CLASS}
          value={value}
          onChange={e => onChange(e.target.value as ThemeChoice)}
        >
          <option value="auto">auto</option>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
      </label>
    </fieldset>
  );
}

/** Network: offline toggle (P-146 posture). */
export function NetworkSection({ value, onChange }: SectionProps<boolean>): JSX.Element {
  return (
    <fieldset aria-label="network settings" className="flex flex-col gap-2">
      <legend className="text-title">Network</legend>
      <label className={ROW_CLASS}>
        <input
          type="checkbox"
          aria-label="offline"
          checked={value}
          onChange={e => onChange(e.target.checked)}
        />
        offline mode
      </label>
    </fieldset>
  );
}

/**
 * Language: the UI locale (P-234). The labels arrive from the i18n catalog so
 * this section stays purely presentational (value + onChange in, no fetching).
 */
export function LanguageSection({
  value,
  onChange,
  labels,
}: SectionProps<string> & {
  readonly labels: { readonly legend: string; readonly label: string };
}): JSX.Element {
  return (
    <fieldset aria-label="language settings" className="flex flex-col gap-2">
      <legend className="text-title">{labels.legend}</legend>
      <label className={ROW_CLASS}>
        {labels.label}
        <select
          aria-label="language"
          className={OPTION_CLASS}
          value={value}
          onChange={e => onChange(e.target.value)}
        >
          {SUPPORTED_LOCALES.map(code => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
