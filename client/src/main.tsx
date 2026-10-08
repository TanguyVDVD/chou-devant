import '@fontsource/bagel-fat-one/latin-400.css';
import '@fontsource/figtree/latin-500.css';
import '@fontsource/figtree/latin-700.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable dans index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
