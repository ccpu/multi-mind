import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './windows/settings/App';
import '@internal/tailwind/globals.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Root element #root is missing from settings.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
