// Minimal React 18 entry — fleshed out in P-208 (Vite scaffold)
import { WEB_NAME } from './index';

const root = document.getElementById('root');
if (root) {
  root.textContent = WEB_NAME;
}
