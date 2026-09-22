# tauri-template

A [Tauri v2](https://v2.tauri.app) desktop application template: a pnpm + Turborepo
monorepo with a React, TypeScript and Tailwind CSS frontend, a Rust backend, and
the lint / format / type-check / test / release pipeline already wired up.

> ⚠️ **Opinionated template.** It follows our internal standards. Fork it, strip
> what you do not need, and make it yours.

## ✨ What is in the box

| Area      | Choice                                                            |
| --------- | ----------------------------------------------------------------- |
| Shell     | Tauri v2 — a Rust core plus the OS webview, no bundled browser     |
| Frontend  | React 19, Vite, TypeScript, Tailwind CSS v4                        |
| Workspace | pnpm workspaces with catalogs, Turborepo                           |
| Quality   | ESLint, Prettier (with Tailwind class sorting), Vitest, clippy, rustfmt |
| CI/CD     | GitHub Actions: checks on every PR, installers for macOS, Windows and Linux on a tag |

## 🚀 Getting started

Prerequisites: Node (see [.node-version](.node-version)), pnpm, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) — Rust plus your
platform's build tools (WebView2 on Windows, Xcode command line tools on macOS,
`libwebkit2gtk-4.1-dev` and friends on Linux).

```sh
pnpm install
pnpm run setup   # one-time: renames the template to your project
pnpm dev         # the desktop app
```

`pnpm run setup` is a one-time step. Until it has run, `pnpm install` prints a
reminder and `git commit` is blocked. It finishes by deleting the `setup/`
folder, so the gate removes itself. It is skipped in CI, in this template repo
itself, and with `SKIP_SETUP_CHECK=1`.

### Everyday commands

| Command            | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `pnpm dev`         | Runs the app: Vite dev server plus the Rust backend, both hot-reloading |
| `pnpm dev:web`     | Frontend alone in a browser — no Rust toolchain needed              |
| `pnpm build`       | Builds the frontend bundle                                          |
| `pnpm bundle`      | Builds installers for the current platform                          |
| `pnpm test`        | Vitest across the workspace                                         |
| `pnpm typecheck`   | `tsc --noEmit` across the workspace                                 |
| `pnpm lint` / `pnpm lint:fix` | ESLint                                                   |
| `pnpm format` / `pnpm format:fix` | Prettier                                             |
| `pnpm rust:fmt` / `pnpm rust:lint` / `pnpm rust:test` | rustfmt, clippy, cargo test      |
| `pnpm fix:all`     | Format, lint and type-check in one go                               |
| `pnpm gen:icons`   | Regenerates the icon set from `apps/desktop/app-icon.png`            |
| `pnpm gen:package` | Scaffolds a new workspace package                                   |

Anything under `apps/` or `packages/` can also be targeted directly:
`pnpm --filter @internal/ui test`.

## 📁 Structure

```
apps/
└── desktop/            # the application
    ├── src/            # React frontend
    └── src-tauri/      # Rust backend, tauri.conf.json, capabilities, icons
packages/
├── tauri-api/          # typed wrappers around the Rust commands
├── ui/                 # shared React components and the theme
└── utils/              # framework-free helpers
tooling/
├── eslint/ prettier/ typescript/ vitest/   # shared configs
├── tailwind/           # globals.css: the theme, imported once by the app
└── vite/               # the Tauri-aware Vite config factory
```

Every package is private and consumed as TypeScript source, so there is no build
step between them — change a component and the app hot-reloads.

Read [apps/desktop/README.md](apps/desktop/README.md) for the app itself:
adding a command, a plugin or a second window.

## 🧭 Coming from Electron?

Tauri splits the same problem differently, and the template's layout follows its
split rather than Electron's.

| Electron                                | Tauri                                                             |
| --------------------------------------- | ----------------------------------------------------------------- |
| Main process (Node.js)                  | Rust core — `apps/desktop/src-tauri/src`                          |
| Renderer process                        | An OS webview loading the Vite build — `apps/desktop/src`         |
| Preload script + `contextBridge`        | Nothing. The frontend has no system access unless a command or a permission grants it |
| `ipcMain.handle` / `ipcRenderer.invoke` | `#[tauri::command]` + `invoke`, wrapped in `@internal/tauri-api`   |
| `nodeIntegration`, `sandbox`, allowlists | `capabilities/*.json` — per-window permissions, checked in Rust    |
| electron-builder                        | The Tauri bundler (`pnpm bundle`)                                 |
| ~100 MB installer with a bundled Chromium | A few MB against the system webview                             |

The practical difference: there is no privileged JavaScript. Anything the UI
needs from the system is a Rust function you chose to expose, which is why the
`packages/tauri-api` boundary exists and why nothing else calls `invoke`.

## 🎨 Styling

Tailwind v4 is configured in CSS, not in a config file. The single entry point is
[tooling/tailwind/globals.css](tooling/tailwind/globals.css): it defines the
theme tokens, registers the workspace packages as sources, and is imported once
in `apps/desktop/src/main.tsx`.

Colors are CSS custom properties that the `.dark` class redefines, so components
use `bg-card` or `text-muted-foreground` and follow the theme automatically —
`dark:` variants are rarely needed. `ThemeProvider` from `@internal/ui` owns the
light / dark / system choice.

## 🤖 CI and releases

| Workflow                                              | Trigger                       | Does                                                    |
| ----------------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| [ci.yml](.github/workflows/ci.yml)                     | push, pull request            | Lint, format, types and tests, plus rustfmt, clippy and `cargo test` |
| [build.yml](.github/workflows/build.yml)               | manual, or called by a release | Builds installers on macOS (both architectures), Windows and Linux |
| [release.yml](.github/workflows/release.yml)           | a `v*` tag                     | Runs CI, then attaches the installers to a draft GitHub release |
| [codeql-analysis.yml](.github/workflows/codeql-analysis.yml) | push, PR, weekly         | CodeQL scan of the TypeScript sources                    |

To cut a release, bump the version in `apps/desktop/package.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` — the last one names the
installers — then:

```sh
git tag v0.2.0
git push origin v0.2.0
```

Review the draft release and publish it. Nothing is signed or notarised out of
the box: see the Tauri guides for
[code signing](https://v2.tauri.app/distribute/sign/) and the
[updater](https://v2.tauri.app/plugin/updater/), both of which come down to
adding secrets to `build.yml`.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 License

MIT. The repository ships without a `LICENSE` file on purpose — add one with
your own copyright line, and keep `license` in `apps/desktop/src-tauri/Cargo.toml`
in step with it.
