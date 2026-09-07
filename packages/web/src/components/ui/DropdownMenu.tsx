import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { JSX } from 'react';

export type MenuOption = {
  value: string;
  label: string;
};

export type StitchDropdownMenuProps = {
  /** Visible trigger text; also its accessible name. */
  triggerLabel: string;
  options: readonly MenuOption[];
  onSelect: (value: string) => void;
};

/**
 * StitchDropdownMenu: row actions for provenance + job history (P-185/224).
 * Single selection callback keyed by option value; the menu closes itself
 * on select (Radix default) and reports the chosen value.
 */
export function StitchDropdownMenu({
  triggerLabel,
  options,
  onSelect,
}: StitchDropdownMenuProps): JSX.Element {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          className="bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50"
        >
          {triggerLabel}
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50">
          {options.map(option => (
            <Dropdown.Item key={option.value} onSelect={() => onSelect(option.value)}>
              {option.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
