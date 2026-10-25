# @internal/multi-mind

Everything Multi Mind knows that is not a window: the settings model, the site
catalogue, prompt presets, the prompt history, the right-click menu model, and
the scripts that go into an embedded chat site.

Nothing here imports Tauri or React. That is the point — this is the part of the
app that outlived a WinForms build and an Electron one, and it is where the
behaviour is tested.

| Module                 | What it holds                                                              |
| ---------------------- | -------------------------------------------------------------------------- |
| `settings.ts`          | `AppSettings`, its defaults, and every edit made to it                     |
| `settings-location.ts` | Where `settings.json` lives, and what moving it can run into               |
| `websites.ts`          | `WebsiteInfo`, the seeded catalogue, and how a site falls back to its seed |
| `prompts.ts`           | Prompt presets and how they wrap a typed prompt                            |
| `history-manager.ts`   | Port of `HistoryManager.cs`, quirks included                               |
| `layout.ts`            | How tall the prompt box is                                                 |
| `browser-automation/`  | Shared prompt workflow, host polling, and temporary WebKit operations      |
| `scripts.ts`           | Two startup reporters and explicit context-menu actions                    |
| `messages.ts`          | The guest bridge protocol and the per-run names its globals take           |
| `context-menu.ts`      | What the right-click menu offers, decided away from the shell              |
| `site-cookies.ts`      | Which cookies belong to a site, and the URL needed to delete one           |
| `guest-windows.ts`     | Whether a site's `window.open` stays in the app or goes to the browser     |

## Guest scripts

`createGuestScripts` returns the initialization scripts one embedded site gets,
in order. The Rust side prepends the bridge itself — the object at
`GuestGlobals.bridgeKey` — because only it can reach Tauri's IPC, and then hands
the whole thing to the webview as its initialization script.

Only one app-owned global remains: the message bridge, named per run. There is
no persistent query helper or response controller on the page.

## Browser automation and remaining injection

The main window sends a structured `BrowserPromptRequest`, rather than a prompt
script. Shared host code handles bounded retries, cancellation, submission and
response completion. Each operation goes through the Rust `guest_automation`
command, restricted to the app's main windows and the configured site's origin.

| Platform      | Execution                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows       | In-process WebView2 DevTools DOM, CSS, Accessibility and Input commands. Prompt actions and response snapshots do not evaluate JavaScript. No remote debugging port is opened by production automation. |
| macOS / Linux | Short JavaScript evaluations through the webview callback API. Composer preparation and insertion happen in separate host tasks; operations are serialized to preserve focus across panes.              |

This is **reduced injection, not zero injection**:

- Every guest still receives Tauri's runtime/IPC scripts, the message bridge,
  one click listener (pane collapse and user cancellation), and one context-menu
  listener. These execute in the page's main world.
- macOS/Linux additionally evaluate temporary DOM operations when sending and
  taking response snapshots. They leave no app globals, timers, observers or
  event listeners behind.
- Explicit context-menu actions such as paste, history navigation and copying
  images still evaluate short scripts on all platforms.
- Native browser callbacks handle new-window requests, page loads and title
  changes. Nothing replaces `window.open`; popup windows receive no app startup
  scripts beyond whatever the Tauri runtime itself installs.

The Windows executor is covered by a native app smoke test. Start the app from
PowerShell with a **temporary test-only** debugging port, then run the test in
another terminal:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=13223'
pnpm dev
# In another terminal:
pnpm --filter @app/desktop test:native:automation
```

The test uses a local chat fixture on `127.0.0.1:80` (the port must be free),
preserves existing panes, sends no messages to provider accounts, and checks
textarea, rich-text and shadow-root composers, disabled buttons, single
submission, completion, Stop cancellation, origin guards and startup scripts.
Close that app and restart from a terminal without the environment override when
finished. macOS/Linux native runtime validation requires those operating systems;
the shared workflow and temporary operations also have automated unit tests.

## Response completion

All built-in page selectors live in `DEFAULT_WEBSITES` in `src/websites.ts`.
Each site's `responseSelectors` defines assistant messages, their enclosing turn,
the generating indicator, the whole-answer finished action, and optionally user
messages. Settings edits override these through the existing `useDefaults` flag.
Older settings receive completion defaults without changing their composer fields.

`response-completion/` holds message validation and the completion tracker.
`browser-automation/watch-response.ts` polls from the host every 750 ms while an
attempt is pending. It requires a new answer with final controls and 1500 ms of
stable content after generation ends. Without a user-message selector, it also
requires observing generation begin. Missing/invalid selectors, errors, timeouts
and cancellation never produce a completion event. Polling stops on completion,
Stop clicks, navigation, pane removal, superseding submissions or a 15-minute
deadline. No MutationObserver or watchdog is installed into the guest.

Desktop features subscribe through `windows/main/response-completion`:

```tsx
useAiResponseCompleted(({ websiteId, attemptId, responseId, url }) => {
  // Run a feature for this completed response.
});

// Non-React consumers use onAiResponseCompleted(callback), which returns cleanup.
```

Events are scoped to the host window and emitted once per app-submitted attempt.
The payload includes `completedAt` and `evidence: 'provider-ui'`, without answer
text. A development-only subscriber shows the provider's completion toast.

To diagnose missing events, enable Verbose in the main window's DevTools console
and filter `[AI response]`. A fresh submission reports `submitted`, then host
observation, generation, and finally completion or a terminal failure.
The trace contains provider IDs and states, without prompt or answer content.
