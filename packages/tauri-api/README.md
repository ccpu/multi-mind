# @internal/tauri-api

The typed boundary between the React frontend and the Rust backend.

In Tauri the frontend talks to Rust through `invoke('command_name', args)`, which
takes a string and hands back `unknown`. That is the one place a rename or a
changed payload can slip past the compiler, so it is confined to this package:
everything else imports `commands` and gets real types.

```ts
import { commands, openExternal, safeCommands } from '@internal/tauri-api';

const greeting = await commands.greet('Ada'); // string
const info = await safeCommands.appInfo(); // Result<AppInfo>

await openExternal('https://tauri.app');
```

## Adding a command

1. Write the `#[tauri::command]` in `apps/desktop/src-tauri/src/commands.rs` and
   register it in the `generate_handler!` list in `lib.rs`.
2. If it returns a struct, add the matching interface to [src/types.ts](src/types.ts).
   The Rust structs use `#[serde(rename_all = "camelCase")]`, so the TypeScript
   side is camelCase.
3. Add the wrapper to `commands` (and `safeCommands` when the failure is
   something the UI should show) in [src/commands.ts](src/commands.ts).

The tests mock `@tauri-apps/api/core`, so they run in plain Node without a
webview — they check that each wrapper calls the right command with the right
argument names, which is exactly the part types cannot check for you.

## Permissions

Calling a plugin from the frontend is not enough; the window also needs the
permission in `apps/desktop/src-tauri/capabilities/default.json`. `openExternal`
works because that file grants `opener:default`. Custom `#[tauri::command]`s do
not need a permission entry — registering them in `generate_handler!` is what
exposes them.
