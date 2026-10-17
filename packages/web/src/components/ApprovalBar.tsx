// P-218 — the gate footer: two-step inline confirm for approve, reason
// textarea for reject. Radix dialog replaces the inline confirm when the
// P-055 wrappers land (recorded ADR-103).

import { useState } from 'react';
import type { JSX } from 'react';

export interface ApprovalBarProps {
  readonly canApprove: boolean;
  /** Shown as an inline alert while approve is blocked (empty = not blocked). */
  readonly blockedText?: string;
  readonly onApprove: () => void;
  readonly onReject: (reason: string) => void;
}

export function ApprovalBar(props: ApprovalBarProps): JSX.Element {
  const [armed, setArmed] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="flex flex-col gap-2" aria-label="approval bar">
      {props.blockedText !== undefined && props.blockedText !== '' && (
        <p role="alert" className="text-body text-warning">
          {props.blockedText}
        </p>
      )}
      <div className="flex items-center gap-2">
        {armed ? (
          <>
            <button
              type="button"
              className="bg-primary px-3 py-1.5 rounded text-body text-white disabled:opacity-50"
              disabled={!props.canApprove}
              onClick={() => {
                setArmed(false);
                props.onApprove();
              }}
            >
              Confirm &amp; Create C
            </button>
            <button
              type="button"
              className="px-2 py-1.5 text-caption text-muted underline"
              onClick={() => setArmed(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="bg-primary px-3 py-1.5 rounded text-body text-white disabled:opacity-50"
            disabled={!props.canApprove}
            onClick={() => setArmed(true)}
          >
            Approve &amp; Create C
          </button>
        )}
      </div>
      <div className="flex items-start gap-2">
        <textarea
          aria-label="Rejection reason"
          className="flex-1 rounded border px-2 py-1 text-body"
          placeholder="Why reject this merge?"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
        <button
          type="button"
          className="px-3 py-1.5 rounded border text-body text-danger disabled:opacity-50"
          disabled={reason.trim() === ''}
          onClick={() => props.onReject(reason.trim())}
        >
          Reject merge
        </button>
      </div>
    </div>
  );
}
