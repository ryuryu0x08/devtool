import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@devtool/ui/fonts';
import '@devtool/ui/theme.css';
import '@devtool/ui/controls.css';
import './styles.css';
import { App } from './App';
import { Toasts } from './ui';

// Light or dark as the system is, following it while open.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const theme = () => document.documentElement.setAttribute('data-theme', dark.matches ? 'dark' : 'light');
theme();
dark.addEventListener('change', theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toasts>
      <App />
    </Toasts>
  </StrictMode>,
);
