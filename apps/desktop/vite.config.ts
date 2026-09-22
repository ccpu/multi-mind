import { fileURLToPath } from 'node:url';
import createAppViteConfig from '@internal/vite/app';

/**
 * Two windows, two entry points. Tauri loads each from the same bundle, so the
 * main window and the settings window are pages of one build rather than the
 * separate renderer packages the Electron port needed.
 */
export default createAppViteConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        settings: fileURLToPath(new URL('settings.html', import.meta.url)),
      },
    },
  },
});
