// P-198 — the shared Ink picker components (single-select, multi-select,
// confirm, free-text) every prompting command routes through.
//
// The components are hand-built over ink's `useInput` instead of `@inkjs/ui`
// (ADR-083): the installed `@inkjs/ui` Select has no `onSelect`, no
// wrap-around (its state reducer returns unchanged at the list edges — read,
// not assumed) and no ESC channel, and stacking a second `useInput` for ESC
// on top of one of its components risks double handling the same keypress.
// The phase's acceptance criteria govern: wrap-around navigation, esc →
// typed cancellation, secret masking, and a theme-painted frame with a
// visible cursor.
//
// One keyboard contract for every component:
//   up/down      move with WRAP-AROUND (left/right ignored)
//   return       submit/pick (confirm: the default choice)
//   space        toggle (multi-select only)
//   backspace    delete the last character (text only)
//   esc          delegate to `onEscape` — the imperative wrappers turn it
//                into a typed `USER_CANCELLED`
//
// Theme: the frame title paints through the CLI's `theme()` tokens and the
// focused row paints `ok` — under `--no-color`/NO_COLOR everything degrades
// to the plain ASCII cursor/marker, so the picker stays readable everywhere.

import { Box, Text, useInput, type Key } from 'ink';
import { useRef, useState, type ReactNode } from 'react';
import { theme } from '../theme.js';

/** One option a picker can present. */
export interface PickerOption {
  label: string;
  value: string;
}

/** Shared shape of every picker: a question and an esc channel. */
export interface PickerProps {
  /** The title line — usually the question. Painted through `theme()`. */
  message: string;
  /** Pressing esc tracks here; absent = esc is ignored. */
  onEscape?: () => void;
}

/** The frame: a rounded box with a theme-painted title above the rows. */
function Frame({ message, children }: { message: string; children?: ReactNode }): ReactNode {
  return (
    <Box flexDirection="column" borderStyle="round" paddingLeft={1} paddingRight={1}>
      <Box marginBottom={1}>
        <Text>{theme('ok', message)}</Text>
      </Box>
      {children}
    </Box>
  );
}

/** One list row: the ASCII cursor marks focus; the focused row paints `ok`. */
function Row({
  focused,
  label,
  marker,
}: {
  focused: boolean;
  label: string;
  marker?: string;
}): ReactNode {
  const cursor = focused ? '> ' : '  ';
  return (
    <Text>
      {cursor}
      {marker === undefined ? '' : `${marker} `}
      {focused ? theme('ok', label) : label}
    </Text>
  );
}

/** `<Select options onSelect>` — arrows move (wrap-around), enter picks. */
export function Select({
  message,
  options,
  onSelect,
  onEscape,
}: PickerProps & {
  options: readonly PickerOption[];
  onSelect: (value: string) => void;
}): ReactNode {
  const [index, setIndex] = useState(0);
  useInput((_input: string, key: Key) => {
    if (key.escape) {
      onEscape?.();
      return;
    }
    if (key.upArrow) {
      setIndex(current => (current - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setIndex(current => (current + 1) % options.length);
      return;
    }
    if (key.return) {
      const option = options[index];
      if (option !== undefined) onSelect(option.value);
    }
  });
  return (
    <Frame message={message}>
      {options.map((option, i) => (
        <Row key={option.value} focused={i === index} label={option.label} />
      ))}
    </Frame>
  );
}

/** `<MultiSelect options onDone>` — space toggles, enter confirms. */
export function MultiSelect({
  message,
  options,
  defaultValue,
  onDone,
  onEscape,
}: PickerProps & {
  options: readonly PickerOption[];
  defaultValue?: readonly string[];
  onDone: (values: string[]) => void;
}): ReactNode {
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(defaultValue ?? []));
  // The submit reads the LIVE set through a ref, not the render-time value —
  // enter must submit every toggle that happened before it, never a stale
  // closure's snapshot of `checked`.
  const checkedRef = useRef<ReadonlySet<string>>(checked);
  checkedRef.current = checked;

  useInput((input: string, key: Key) => {
    if (key.escape) {
      onEscape?.();
      return;
    }
    if (key.upArrow) {
      setIndex(current => (current - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setIndex(current => (current + 1) % options.length);
      return;
    }
    if (input === ' ') {
      const option = options[index];
      if (option === undefined) return;
      setChecked(current => {
        const next = new Set(current);
        if (next.has(option.value)) next.delete(option.value);
        else next.add(option.value);
        return next;
      });
      return;
    }
    if (key.return) {
      onDone(
        options.filter(option => checkedRef.current.has(option.value)).map(option => option.value)
      );
    }
  });
  return (
    <Frame message={message}>
      {options.map((option, i) => (
        <Row
          key={option.value}
          focused={i === index}
          label={option.label}
          marker={checked.has(option.value) ? '[x]' : '[ ]'}
        />
      ))}
    </Frame>
  );
}

/** `<Confirm message default>` — y/n, or enter for the default choice. */
export function Confirm({
  message,
  defaultChoice,
  onResolve,
  onEscape,
}: PickerProps & {
  defaultChoice: boolean;
  onResolve: (choice: boolean) => void;
}): ReactNode {
  useInput((input: string, key: Key) => {
    if (key.escape) {
      onEscape?.();
      return;
    }
    if (input === 'y') {
      onResolve(true);
      return;
    }
    if (input === 'n') {
      onResolve(false);
      return;
    }
    if (key.return) {
      onResolve(defaultChoice);
    }
  });
  return (
    <Frame message={message}>
      <Text>choose y or n ({defaultChoice ? 'Y/n' : 'y/N'})</Text>
    </Frame>
  );
}

/** `<TextInput placeholder onSubmit>` — type + enter; `secret` masks. */
export function TextInput({
  message,
  placeholder,
  secret,
  defaultValue,
  onSubmit,
  onEscape,
}: PickerProps & {
  placeholder?: string;
  secret?: boolean;
  defaultValue?: string;
  onSubmit: (value: string) => void;
}): ReactNode {
  const [value, setValue] = useState<string>(defaultValue ?? '');
  useInput((input: string, key: Key) => {
    if (key.escape) {
      onEscape?.();
      return;
    }
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.backspace) {
      setValue(current => current.slice(0, -1));
      return;
    }
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.ctrl) {
      return;
    }
    if (input.length > 0) {
      setValue(current => `${current}${input}`);
    }
  });
  // The typed value never enters the frame when `secret` is on — its LENGTH
  // does, as asterisks (a prompt that echoes a key is not a secret prompt).
  const shown =
    value.length === 0 ? (placeholder ?? '') : secret === true ? '*'.repeat(value.length) : value;
  return (
    <Frame message={message}>
      <Text>{shown}</Text>
    </Frame>
  );
}
