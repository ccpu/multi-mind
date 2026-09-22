# @internal/multi-mind

Everything Multi Mind knows that is not a window: the settings model, the site
catalogue, prompt presets, the prompt history, the right-click menu model, and
the scripts that go into an embedded chat site.

Nothing here imports Tauri or React. That is the point — this is the part of the
app that outlived a WinForms build and an Electron one, and it is where the
behaviour is tested.

| Module                 | What it holds                                                                  |
| ---------------------- | ------------------------------------------------------------------------------ |
| `settings.ts`          | `AppSettings`, its defaults, and every edit made to it                         |
| `settings-location.ts` | Where `settings.json` lives, and what moving it can run into                   |
| `websites.ts`          | `WebsiteInfo`, the seeded catalogue, and how a site falls back to its seed     |
| `prompts.ts`           | Prompt presets and how they wrap a typed prompt                                |
| `history-manager.ts`   | Port of `HistoryManager.cs`, quirks included                                   |
| `layout.ts`            | How tall the prompt box is                                                     |
| `scripts.ts`           | The JavaScript that goes into a guest: the prompt runner, the bridge reporters |
| `messages.ts`          | The guest bridge protocol and the per-run names its globals take               |
| `context-menu.ts`      | What the right-click menu offers, decided away from the shell                  |
| `site-cookies.ts`      | Which cookies belong to a site, and the URL needed to delete one               |
| `guest-windows.ts`     | Whether a site's `window.open` stays in the app or goes to the browser         |

## Guest scripts

`createGuestScripts` returns the initialization scripts one embedded site gets,
in order. The Rust side prepends the bridge itself — the object at
`GuestGlobals.bridgeKey` — because only it can reach Tauri's IPC, and then hands
the whole thing to the webview as its initialization script.

The names both globals take are generated per run by `createGuestGlobals`. A
fixed name would let any AI chat site recognise the app that is embedding it,
and block it by name.
