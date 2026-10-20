// P-228 — mandated tests VERBATIM: 'boundary catches render error',
// 'per route isolation', 'maps core codes', 'alert severities'.
//
// No jest-dom in this repo — toBeTruthy/toBeNull style throughout.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Alert } from './Alert.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { toUiError } from '../lib/errors.js';
import type { JSX } from 'react';

/** Render-thrower whose message can carry an embedded stitch code. */
function Thrower({ msg }: { readonly msg: string }): JSX.Element {
  throw new Error(msg);
}

function Ok({ label }: { readonly label: string }): JSX.Element {
  return <p>{label}</p>;
}

describe('ErrorBoundary (P-228)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('boundary catches render error', () => {
    render(
      <ErrorBoundary label="probe">
        <Thrower msg="CONFIG_ERROR: bad port" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Configuration problem')).toBeTruthy();
    expect(screen.getByText('CONFIG_ERROR: bad port')).toBeTruthy();
    expect(screen.getByTestId('error-id').textContent?.startsWith('error id: ')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'reload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'copy error id' })).toBeTruthy();
    expect(console.error).toHaveBeenCalled();
  });

  it('per route isolation', () => {
    render(
      <div>
        <ErrorBoundary>
          <Ok label="ok A" />
        </ErrorBoundary>
        <ErrorBoundary>
          <Thrower msg="-license-" />
        </ErrorBoundary>
      </div>
    );
    expect(screen.getByText('ok A')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'reload' })).toBeTruthy();
  });

  it('maps core codes', () => {
    const license = toUiError('LICENSE_VIOLATION', new Error('deny'));
    expect(license.recovery).toContain('stitch license');
    expect(license.title).toBe('License policy blocked this');

    const ai = toUiError('AI_PROVIDER_ERROR', new Error('upstream 500'));
    expect(ai.recovery).toContain('API key');

    const scanned = toUiError(undefined, new Error('CONFIG_ERROR: missing field'));
    expect(scanned.family).toBe('config');

    const plain = toUiError(undefined, new Error('mystery failure'));
    expect(plain.title).toBe('Something went wrong');
    expect(plain.message).toBe('mystery failure');
  });

  it('alert severities', () => {
    render(
      <div>
        <Alert severity="error">bad</Alert>
        <Alert severity="warning">warned</Alert>
        <Alert severity="success">fine</Alert>
      </div>
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBe(3);
    expect(alerts[0]?.className).toContain('text-danger');
    expect(alerts[1]?.className).toContain('text-warning');
    expect(alerts[2]?.className).toContain('text-success');
  });
});
