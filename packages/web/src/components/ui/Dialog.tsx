import * as Dialog from '@radix-ui/react-dialog';
import type { JSX, ReactNode } from 'react';
import { X } from 'lucide-react';

export type StitchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Required: Radix links it as the accessible description, keeping axe clean. */
  description: string;
  /** Accessible name for the dismiss button (always rendered). */
  closeLabel: string;
  children?: ReactNode;
};

/**
 * StitchDialog: controlled modal for approvals (P-218) and settings
 * (P-225). Always renders Title + Description (Radix requires both for a
 * named, described dialog) and a labelled dismiss button; overlay +
 * panel follow the stitch scale with dark variants.
 */
export function StitchDialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
}: StitchDialogProps): JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-stitch-950/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
          <Dialog.Close asChild>
            <button type="button" aria-label={closeLabel}>
              <X size={16} aria-hidden="true" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
