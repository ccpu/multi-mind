# @internal/utils

Framework-free helpers shared by the app and the other packages. No React, no
Tauri imports — anything that touches either belongs in `@internal/ui` or
`@internal/tauri-api`.

- `cn(...classes)` — merge Tailwind classes, last conflicting utility wins.
- `formatBytes`, `truncate` — display formatting.
- `Result<T>`, `ok`, `err`, `toResult` — turn a rejecting promise into a value
  so expected failures do not need try/catch at every call site.
