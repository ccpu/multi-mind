import { appConfig } from '@internal/configs';
import { ThemeProvider } from '@internal/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './windows/main/App';
import '@internal/tailwind/globals.css';
// EasyMDE's own stylesheet first, then the overrides that fit it to the panel
// and to the app's theme.
import 'easymde/dist/easymde.min.css';
import './windows/main/styles/prompt-editor.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider defaultTheme={appConfig.theme.defaultTheme}>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
