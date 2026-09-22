import process from 'node:process';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { mergeConfig } from 'vite';

/**
 * Set by `tauri dev` when a mobile device or another machine has to reach the
 * dev server; unset for a plain desktop run, where localhost is enough.
 */
const host = process.env.TAURI_DEV_HOST;

/** Set by the Tauri CLI while it builds the frontend, never in a browser-only run. */
const platform = process.env.TAURI_ENV_PLATFORM;
const isDebugBuild = Boolean(process.env.TAURI_ENV_DEBUG);

const DEV_SERVER_PORT = 1420;
const HMR_PORT = 1421;

/**
 * Vite configuration for a Tauri window.
 *
 * The defaults are what Tauri needs rather than what a website needs: a fixed
 * port the Rust side can point `devUrl` at, no screen clearing so `cargo`
 * errors stay readable, and a build target chosen from the webview that will
 * actually run the bundle instead of from a browserslist query.
 *
 * @param {import('vite').UserConfig} [options] - Extra Vite config, deep merged over the defaults.
 * @returns {import('vite').UserConfig} The merged configuration.
 */
export function createAppViteConfig(options = {}) {
  /** @type {import('vite').UserConfig} */
  const baseConfig = {
    plugins: [react(), tailwindcss()],

    // Vite's cleared screen would eat the Rust compiler output.
    clearScreen: false,

    server: {
      port: DEV_SERVER_PORT,
      // Fail loudly instead of silently moving to another port that
      // `devUrl` in tauri.conf.json does not know about.
      strictPort: true,
      host: host ?? false,
      hmr: host === undefined ? undefined : { protocol: 'ws', host, port: HMR_PORT },
      watch: {
        // Rust changes are watched by the Tauri CLI, not by Vite.
        ignored: ['**/src-tauri/**'],
      },
    },

    // `TAURI_ENV_*` is exposed so the frontend can branch on the platform it
    // was bundled for without reaching into the Rust side.
    envPrefix: ['VITE_', 'TAURI_ENV_'],

    build: {
      // Windows ships Edge WebView2 (Chromium); macOS and Linux ship WebKit.
      // `safari15` rather than the older `safari13`: esbuild refuses to lower
      // destructuring for Safari below 15, so an older target fails the build
      // outright on dependencies that use it.
      target: platform === 'windows' ? 'chrome105' : 'safari15',
      minify: isDebugBuild ? false : 'esbuild',
      sourcemap: isDebugBuild,
    },
  };

  return mergeConfig(baseConfig, options);
}

export default createAppViteConfig;
