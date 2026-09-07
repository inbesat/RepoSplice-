import * as Tabs from '@radix-ui/react-tabs';
import type { JSX, ReactNode } from 'react';

export type TabSpec = {
  value: string;
  label: string;
  content: ReactNode;
};

export type StitchTabsProps = {
  /** Accessible name for the tab list (P-231). */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  tabs: readonly TabSpec[];
};

/**
 * StitchTabs: wizard stepper + panel tabs (P-210/219). Controlled active
 * value; exactly one panel mounted at a time (Radix default), so hidden
 * steps never leak into AT or queries.
 */
export function StitchTabs({ label, value, onValueChange, tabs }: StitchTabsProps): JSX.Element {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange}>
      <Tabs.List aria-label={label}>
        {tabs.map(tab => (
          <Tabs.Trigger key={tab.value} value={tab.value}>
            {tab.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map(tab => (
        <Tabs.Content key={tab.value} value={tab.value}>
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
