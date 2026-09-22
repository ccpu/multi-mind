# @internal/ui

The shared React components and the theme, styled with the Tailwind tokens from
`@internal/tailwind`.

```tsx
import { Button, Card, ThemeProvider, ThemeToggle, useTheme } from '@internal/ui';
```

## Theme

`ThemeProvider` stores the choice (`light` / `dark` / `system`) in
`localStorage`, follows the OS when `system` is selected, and toggles the `dark`
class on `<html>`. Components do not need `dark:` variants: the colors are CSS
custom properties that the `.dark` block redefines, so `bg-card` is the right
color in both themes.

`useTheme()` returns `{ theme, resolvedTheme, setTheme }` and throws when used
outside the provider.

## Components

Components take a `className` that is merged with `cn()`, so a caller can
override a utility without fighting specificity.

| Component     | Notes                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `Button`      | `variant`: primary / secondary / outline / ghost, `size`: sm / md / lg. Defaults to `type="button"`. |
| `Card`        | Optional `title` and `description` header.                                                           |
| `TextInput`   | Labelled input; the label is wired to the input with `useId`.                                        |
| `ThemeToggle` | Segmented light / dark / system control.                                                             |

This is deliberately a small set — enough to build the template's window. Add a
component here as soon as a second window would need it, and keep anything
app-specific in `apps/desktop/src/components`.
