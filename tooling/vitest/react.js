import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import defineConfig from '@pixpilot/dev-config/vitest';
import react from '@vitejs/plugin-react';

const currentDir = dirname(fileURLToPath(import.meta.url));

/**
 * Vitest configuration for packages that render React components.
 * Everything else should use the default export of this package.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [resolve(currentDir, 'react.setup.js')],
  },
});
