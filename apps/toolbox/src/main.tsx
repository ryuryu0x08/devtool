import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@devtool/ui/fonts';
import '@devtool/ui/theme.css';
import '@devtool/ui/controls.css';
import './styles.css';
import { App } from './App';
import { markDesktop } from './lib/desktop';

markDesktop();

// An error a tool's boundary caught is shown in the page (components/ToolBoundary.tsx), so it is
// logged as a warning; uncaught errors are still errors.
createRoot(document.getElementById('root')!, {
  onCaughtError: (error, info) => console.warn('Handled by the tool’s error boundary:', error, info.componentStack),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
