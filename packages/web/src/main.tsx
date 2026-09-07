// Web entry — mounted by Vite dev/preview (P-208 fleshes out routing/store).
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
