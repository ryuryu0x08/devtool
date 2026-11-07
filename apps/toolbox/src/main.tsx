import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import './styles.css';
import { App } from './App';

// An error a tool's boundary caught is shown in the page (components/ToolBoundary.tsx), so it is
// logged as a warning; uncaught errors are still errors.
createRoot(document.getElementById('root')!, {
  onCaughtError: (error, info) => console.warn('Handled by the tool’s error boundary:', error, info.componentStack),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
