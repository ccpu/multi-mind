# Multi Mind

One prompt box driving several AI chat sites side by side. Type once, send to
Claude, ChatGPT, Gemini, DeepSeek and the rest at the same time, and read the
answers next to each other.

A [Tauri v2](https://v2.tauri.app) desktop app — Rust core, OS webview, React
frontend — in a pnpm + Turborepo monorepo.

## What it does

- **One prompt, many sites.** Each site runs in its own embedded webview and is
  driven by a script that fills its input and clicks its send button.
- **Your own logins.** Sites are used signed in as you; there are no API keys
  and no server in the middle.
- **An editable site catalogue.** Seven sites ship configured. Add your own,
  reorder them, or fix a selector when a site is redesigned — sites set to
  follow their defaults pick up shipped fixes automatically.
- **Prompt presets.** Saved wrappers that a typed prompt drops into, with a
  markdown or plain editor and prompt history.
- **A settings window** for the prompt box, the site list, where `settings.json`
  lives, and automatic updates.

| Site       | Enabled by default |
| ---------- | ------------------ |
| Claude     | yes                |
| ChatGPT    | yes                |
| Gemini     | yes                |
| DeepSeek   | yes                |
| Grok       | no                 |
| Perplexity | no                 |
| Qwen       | no                 |

Installers for macOS, Windows and Linux are attached to each
[release](https://github.com/ccpu/multi-mind/releases), and the app updates
itself unless you turn that off.

## 🚀 Getting started

Prerequisites: Node (see [.node-version](.node-version)), pnpm, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) — Rust plus your
platform's build tools (WebView2 on Windows, Xcode command line tools on macOS,
`libwebkit2gtk-4.1-dev` and friends on Linux).

```sh
pnpm install
pnpm dev     # the desktop app
```

### Everyday commands

| Command                                               | What it does                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                                            | Runs the app: Vite dev server plus the Rust backend, both hot-reloading |
| `pnpm dev:web`                                        | Frontend alone in a browser — no Rust toolchain needed                  |
| `pnpm build`                                          | Builds the frontend bundle                                              |
| `pnpm bundle`                                         | Builds installers for the current platform                              |
| `pnpm test`                                           | Vitest across the workspace                                             |
| `pnpm typecheck`                                      | `tsc --noEmit` across the workspace                                     |
| `pnpm lint` / `pnpm lint:fix`                         | ESLint                                                                  |
| `pnpm format` / `pnpm format:fix`                     | Prettier                                                                |
| `pnpm rust:fmt` / `pnpm rust:lint` / `pnpm rust:test` | rustfmt, clippy, cargo test                                             |
| `pnpm fix:all`                                        | Format, lint and type-check in one go                                   |
| `pnpm gen:icons`                                      | Regenerates the icon set from `apps/desktop/public/logo.svg`            |
| `pnpm gen:package`                                    | Scaffolds a new workspace package                                       |

Anything under `apps/` or `packages/` can also be targeted directly:
`pnpm --filter @internal/ui test`.

## 📁 Structure

```
apps/
└── desktop/            # the application
    ├── src/            # React frontend: windows/main, windows/settings
    └── src-tauri/      # Rust backend, tauri.conf.json, capabilities, icons
packages/
├── multi-mind/         # settings, sites, prompts, history, guest scripts
├── configs/            # the few values that describe the app itself
├── tauri-api/          # typed wrappers around the Rust commands
├── ui/                 # shared React components and the theme
└── utils/              # framework-free helpers
tooling/
├── eslint/ prettier/ typescript/ vitest/ tsdown/   # shared configs
├── tailwind/           # globals.css: the theme, imported once by the app
└── vite/               # the Tauri-aware Vite config factory
```

[packages/multi-mind](packages/multi-mind/README.md) holds the behaviour and is
where it is tested — it imports neither Tauri nor React. Everything else is the
shell around it.

Every package is private and consumed as TypeScript source, so there is no build
step between them — change a component and the app hot-reloads.

Read [apps/desktop/README.md](apps/desktop/README.md) for the app itself: adding
a command, a plugin or a second window.

## 🎨 Styling

Tailwind v4 is configured in CSS, not in a config file. The single entry point is
[tooling/tailwind/globals.css](tooling/tailwind/globals.css): it defines the
theme tokens, registers the workspace packages as sources, and is imported once
per window entry point.

Colors are CSS custom properties that the `.dark` class redefines, so components
use `bg-card` or `text-muted-foreground` and follow the theme automatically —
`dark:` variants are rarely needed. `ThemeProvider` from `@internal/ui` owns the
light / dark / system choice.

## 🤖 CI and releases

| Workflow                                                     | Trigger                     | Does                                                                          |
| ------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------- |
| [ci.yml](.github/workflows/ci.yml)                           | push, pull request          | Lint, format, types and tests, plus rustfmt, clippy and `cargo test`          |
| [release.yml](.github/workflows/release.yml)                 | push to `main`, manual      | Uses conventional commits to version, tag and publish a GitHub release        |
| [build.yml](.github/workflows/build.yml)                     | called by a release, manual | Builds installers on macOS (both architectures), Windows and Linux            |
| [deploy.yml](.github/workflows/deploy.yml)                   | called by a release         | Attaches the installers to the release and writes the updater's `latest.json` |
| [codeql-analysis.yml](.github/workflows/codeql-analysis.yml) | push, PR, weekly            | CodeQL scan of the TypeScript sources                                         |

Use [Conventional Commits](https://www.conventionalcommits.org/) on `main`.
Pushing a `fix:` commit creates a patch release; `feat:` creates a minor
release; and a breaking-change footer creates a major release. The Release
workflow updates `package.json`, `apps/desktop/package.json`,
`apps/desktop/src-tauri/Cargo.toml` and
`apps/desktop/src-tauri/tauri.conf.json`, then tags the version, creates a
GitHub release, builds the installers and attaches them.

For example:

```sh
git commit -m "feat: add a new AI provider"
git push origin main
```

Updater artifacts are signed when `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are set as repository secrets. Installers
themselves are not code-signed or notarised — see the Tauri
[code signing guide](https://v2.tauri.app/distribute/sign/) for that.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 License

MIT.
