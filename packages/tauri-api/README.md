# @internal/tauri-api

The boundary between the windows and Rust. Nothing else in the workspace calls
`invoke` or `listen`.

`invoke` takes a command name as a string and gives back `unknown`, so a renamed
command or a changed payload is a runtime failure in whatever window happened to
make the call. Going through this package turns both into build errors.

## The shape

`appApi` keeps the shape the Electron port used, because the windows were
written against it:

```ts
import { appApi } from '@internal/tauri-api';

const settings = await appApi.invoke.getSettings();
const stop = appApi.events.onSettingsChanged(setSettings);
await appApi.guest.run(websiteId, script);
```

| Group           | What it covers                                                              |
| --------------- | --------------------------------------------------------------------------- |
| `invoke`        | Settings, where the settings file lives, opening a window                    |
| `events`        | `onSettingsChanged`, `onGuestMessage` — each returns its own unsubscribe     |
| `guest`         | The embedded browsers: sync, navigate, eval, cookies, menu, DevTools         |

`openExternal` is separate: it goes to the opener plugin rather than to a
command of ours, and checks the protocol before it does.

## Guests

An embedded chat site is a child webview of the window, created and positioned
by Rust. `appApi.guest.sync` takes the whole list of panes rather than one
change at a time — opening, closing and moving are the same layout pass, and
reconciling from a complete picture is what keeps a divider drag from racing a
site being switched on.

Everything about *what* a guest should do stays in `@internal/multi-mind`: the
scripts it runs, what its right-click menu offers, which of its cookies belong
to the site. This package only carries them across.
