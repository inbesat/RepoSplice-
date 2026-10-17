// P-211 — the Sources screen: the A slot's picker; success advances the flow
// to the Select step (P-213 fills that screen).

import { useNavigate } from 'react-router';
import type { JSX } from 'react';
import { RepoPicker } from '../components/RepoPicker.js';

export function SourcesPage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <RepoPicker
      slot="A"
      onResolved={() => {
        // The resolved source is in the store; the stepper's next step unlocks via
        // the flow-visited effect AppShell already runs on navigation.
        navigate('/select');
      }}
    />
  );
}
