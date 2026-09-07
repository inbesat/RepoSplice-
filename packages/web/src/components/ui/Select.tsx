import * as Select from '@radix-ui/react-select';
import type { JSX } from 'react';

export type SelectOption = {
  value: string;
  label: string;
};

export type StitchSelectProps = {
  /** Accessible name for the trigger (P-231). */
  label: string;
  /** Text shown when nothing is selected. */
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
};

/**
 * StitchSelect: picker for source/model selects (P-211/212). Controlled
 * value; trigger carries the accessible name and the placeholder; options
 * render in a portal so clipping ancestors never cut the list.
 */
export function StitchSelect({
  label,
  placeholder,
  value,
  onValueChange,
  options,
}: StitchSelectProps): JSX.Element {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        aria-label={label}
        className="bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50"
      >
        <Select.Value placeholder={placeholder} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50">
          <Select.Viewport>
            {options.map(option => (
              <Select.Item key={option.value} value={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
