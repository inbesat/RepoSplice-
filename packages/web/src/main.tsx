// Web entry — mounted by Vite dev/preview (P-208 fleshes out routing/store).
// The variable Inter face is imported HERE, not in CSS: the postcss pipeline
// in styles.test.ts does not resolve package imports from stylesheets.
import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const rootEl = document.getElementById('root');
if (rootEl !== null) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
