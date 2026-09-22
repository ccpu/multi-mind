# @internal/tailwind

The single Tailwind CSS entry point for the workspace.

## Usage

Import it once, in the app's entry file, before any component:

```ts
// apps/desktop/src/main.tsx
import '@internal/tailwind/globals.css';
```

`globals.css` imports Tailwind v4, registers the workspace `packages/*` sources so
classes used there are not purged, defines the light/dark theme tokens, and sets a
handful of desktop-appropriate base styles.

## Theming

Colors are plain CSS custom properties declared in `@theme`, so every token is
available as a utility (`bg-background`, `text-muted-foreground`, `border-border`,
…). The `.dark` class — toggled by `ThemeProvider` from `@internal/ui` — overrides
the same properties, so no component needs a `dark:` variant to follow the theme.

Add or change a color in one place here and every package and window picks it up.
