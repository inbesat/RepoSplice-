import type { JSX } from 'react';
import { Check, Circle, TriangleAlert, X } from 'lucide-react';

/** Status kinds for shell + status indicators (P-210/P-221). */
export type StatusKind = 'ok' | 'warn' | 'err' | 'idle';

const STATUS_ICONS = {
  ok: Check,
  warn: TriangleAlert,
  err: X,
  idle: Circle,
} as const satisfies Record<StatusKind, typeof Check>;

export type StatusIconProps = {
  status: StatusKind;
  size?: number;
  className?: string;
};

/**
 * StatusIcon: semantic status glyph for the dashboard shell (P-210) and
 * status indicators (P-221). Decorative by design (`aria-hidden`) — any
 * meaning it carries must also exist as adjacent text for AT (P-231).
 */
export function StatusIcon({ status, size = 16, className }: StatusIconProps): JSX.Element {
  const Icon = STATUS_ICONS[status];
  const sized = className === undefined ? { size } : { size, className };
  return <Icon {...sized} aria-hidden="true" />;
}
