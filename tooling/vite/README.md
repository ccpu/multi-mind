# @internal/vite

Shared Vite configuration for Tauri windows.

```ts
// apps/desktop/vite.config.ts
import createAppViteConfig from '@internal/vite/app';

export default createAppViteConfig();
```

Pass a normal Vite config to extend it — it is deep merged over the defaults:

```ts
export default createAppViteConfig({
  build: { sourcemap: true },
});
```

## What the defaults do

| Default                                  | Why                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| React + Tailwind v4 plugins              | The whole workspace is React and Tailwind; no window repeats the wiring. |
| `server.port: 1420`, `strictPort`        | `devUrl` in `tauri.conf.json` is a fixed URL, so the port cannot drift.  |
| `server.host` from `TAURI_DEV_HOST`      | Lets a device or VM reach the dev server; unset means localhost only.    |
| `clearScreen: false`                     | Keeps `cargo` errors on screen.                                          |
| `watch.ignored: ['**/src-tauri/**']`     | The Tauri CLI already watches the Rust sources.                          |
| `envPrefix: ['VITE_', 'TAURI_ENV_']`     | Exposes the platform Tauri is bundling for to the frontend.              |
| `build.target` from `TAURI_ENV_PLATFORM` | Targets the webview that will run the bundle, not a browserslist query.  |

Adding a second window means a second Vite config that calls the same factory.
