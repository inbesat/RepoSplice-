// P-225 — the settings page: load → edit → per-section PATCH.
//
// One draft for the whole page; `dirty` (draft differs from loaded) arms the
// unsaved-changes guard: a document-level click interceptor on internal <a>
// links plus beforeunload — confirm() or stay (no data router, so useBlocker
// is unavailable; ADR-110). Key status renders set/not-set ONLY — a key value
// from the payload is never mapped into state.

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router';
import { getSettings, patchSettings, type SettingsData } from '../api/settings.js';
import {
  AiSection,
  AppearanceSection,
  LicensesSection,
  NetworkSection,
  SandboxSection,
} from '../components/settings/sections.js';
import { getSandboxCapabilities } from '../api/sandbox.js';

const UNSAVED_MESSAGE = 'Unsaved changes — leave anyway?';

interface Draft {
  provider: 'openrouter' | 'anthropic' | 'ollama';
  model: string;
  streaming: boolean;
  maxTokens: number;
  theme: 'light' | 'dark' | 'auto';
  policy: 'allow' | 'deny';
  allow: readonly string[];
  warn: readonly string[];
  deny: readonly string[];
  timeoutSec: number;
  memory: string;
  offline: boolean;
}

function snapToDraft(data: SettingsData): Draft {
  return {
    provider: 'openrouter',
    model: data.model ?? 'openrouter/anthropic/claude-3.5-sonnet',
    streaming: data.streaming ?? true,
    maxTokens: data.maxTokens ?? 0,
    theme: data.theme ?? 'auto',
    policy: 'deny',
    allow: data.licensePolicy?.allow ?? [],
    warn: data.licensePolicy?.warn ?? [],
    deny: data.licensePolicy?.deny ?? [],
    timeoutSec: data.timeoutSec ?? 600,
    memory: data.memory ?? '2g',
    offline: data.offline ?? false,
  };
}

function snapOf(draft: Draft): string {
  return JSON.stringify({
    model: draft.model,
    streaming: draft.streaming,
    maxTokens: draft.maxTokens,
    theme: draft.theme,
    allow: draft.allow,
    warn: draft.warn,
    deny: draft.deny,
    timeoutSec: draft.timeoutSec,
    memory: draft.memory,
    offline: draft.offline,
  });
}

export function SettingsPage(): JSX.Element {
  const [loaded, setLoaded] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [capability, setCapability] = useState('checking…');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getSettings(), getSandboxCapabilities()])
      .then(([data, caps]) => {
        if (cancelled) return;
        setLoaded(data);
        setDraft(snapToDraft(data));
        setCapability(caps.backend);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(
    () => loaded !== null && draft !== null && snapOf(draft) !== snapOf(snapToDraft(loaded)),
    [loaded, draft]
  );

  // Unsaved-changes guard: intercept internal anchor clicks + beforeunload.
  useEffect(() => {
    if (!dirty) return undefined;
    // Capture phase: react-router's Link navigates in its own handler, so a
    // bubble-phase preventDefault would arrive too late.
    const onClick = (e: MouseEvent): void => {
      const anchor = (e.target as HTMLElement | null)?.closest('a') ?? null;
      if (anchor !== null && anchor.getAttribute('href')?.startsWith('/') === true) {
        if (!window.confirm(UNSAVED_MESSAGE)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  const saveAi = useCallback(async (): Promise<void> => {
    if (draft === null) return;
    if (!Number.isInteger(draft.maxTokens) || draft.maxTokens < 0) {
      setError('max tokens must be a non-negative integer');
      return;
    }
    try {
      await patchSettings({
        openrouter: { defaultModel: draft.model },
        agent: { maxTokens: draft.maxTokens },
      });
      setSaved('ai settings saved');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft]);

  const saveLicenses = useCallback(async (): Promise<void> => {
    if (draft === null) return;
    try {
      await patchSettings({
        licensePolicy: { allow: draft.allow, warn: draft.warn, deny: draft.deny },
      });
      setSaved('license policy saved');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft]);

  const saveSandbox = useCallback(async (): Promise<void> => {
    if (draft === null) return;
    if (!Number.isInteger(draft.timeoutSec) || draft.timeoutSec <= 0) {
      setError('timeout must be a positive integer number of seconds');
      return;
    }
    if (draft.memory.trim() === '') {
      setError('memory must not be empty');
      return;
    }
    try {
      await patchSettings({
        sandbox: { limits: { timeout: draft.timeoutSec, memory: draft.memory.trim() } },
      });
      setSaved('sandbox defaults saved');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft]);

  const saveAppearance = useCallback(async (): Promise<void> => {
    if (draft === null) return;
    try {
      await patchSettings({ appearance: { theme: draft.theme } });
      setSaved('theme saved');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft]);

  const saveNetwork = useCallback(async (): Promise<void> => {
    if (draft === null) return;
    try {
      await patchSettings({ network: { offline: draft.offline } });
      setSaved('network setting saved');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft]);

  if (draft === null) {
    return (
      <section aria-label="settings" className="p-4">
        <h2 className="text-title">Settings</h2>
        {error !== null ? (
          <div role="alert" className="text-body text-danger">
            ✘ {error}
          </div>
        ) : (
          <p className="text-muted">Loading settings…</p>
        )}
      </section>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft(prev => (prev === null ? prev : { ...prev, [key]: value }));

  const saveBtn = (label: string, onClick: () => void, testId: string): JSX.Element => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => void onClick()}
      className="text-body bg-primary text-white rounded px-3 py-1 self-start"
    >
      {label}
    </button>
  );

  return (
    <section aria-label="settings" className="flex flex-col gap-6 p-4">
      <h2 className="text-title">Settings</h2>
      {dirty && (
        <p role="status" data-testid="unsaved-note" className="text-caption text-warning">
          unsaved changes — saving a section clears the note
        </p>
      )}
      {error !== null && (
        <div role="alert" className="text-body text-danger">
          ✘ {error}
        </div>
      )}
      {saved !== null && (
        <p role="status" data-testid="saved-note" className="text-body text-success">
          ✓ {saved}
        </p>
      )}
      <AiSection
        value={{
          provider: draft.provider,
          model: draft.model,
          streaming: draft.streaming,
          maxTokens: draft.maxTokens,
        }}
        onChange={next =>
          setDraft(prev =>
            prev === null
              ? prev
              : {
                  ...prev,
                  provider: next.provider,
                  model: next.model,
                  streaming: next.streaming,
                  maxTokens: next.maxTokens,
                }
          )
        }
      />
      {saveBtn('Save AI', saveAi, 'save-ai')}
      <LicensesSection
        value={{ policy: draft.policy, allow: draft.allow, warn: draft.warn, deny: draft.deny }}
        onChange={next =>
          setDraft(prev =>
            prev === null
              ? prev
              : {
                  ...prev,
                  policy: next.policy,
                  allow: next.allow,
                  warn: next.warn,
                  deny: next.deny,
                }
          )
        }
      />
      {saveBtn('Save licenses', saveLicenses, 'save-licenses')}
      <SandboxSection
        value={{ timeoutSec: draft.timeoutSec, memory: draft.memory }}
        onChange={next => setDraft(prev => (prev === null ? prev : { ...prev, ...next }))}
        capability={capability}
      />
      {saveBtn('Save sandbox', saveSandbox, 'save-sandbox')}
      <AppearanceSection value={draft.theme} onChange={next => set('theme', next)} />
      {saveBtn('Save appearance', saveAppearance, 'save-appearance')}
      <NetworkSection value={draft.offline} onChange={next => set('offline', next)} />
      {saveBtn('Save network', saveNetwork, 'save-network')}
      <div aria-label="provider key status" className="flex flex-col gap-1">
        <span className="text-title">Provider keys</span>
        {['openrouter', 'anthropic'].map(name => (
          <p key={name} data-testid={`key-${name}`} className="text-body">
            {name} key: {(loaded?.keys?.[name] ?? false) ? 'set' : 'not set'}
          </p>
        ))}
      </div>
      <p className="text-caption text-muted">
        <Link to="/sources" className="text-primary underline">
          back to sources
        </Link>
      </p>
    </section>
  );
}
