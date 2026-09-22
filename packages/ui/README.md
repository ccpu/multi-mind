# @internal/ui

One import surface for both windows.

Almost everything here is a re-export of [`@pixpilot/shadcn-ui`](https://www.npmjs.com/package/@pixpilot/shadcn-ui),
which is the app's design system. Import from `@internal/ui` rather than from it
directly, so a change of design system is one file rather than every component.

Reach for `@pixpilot/shadcn` when you need a raw shadcn primitive the wrapper
does not re-export — `DropdownMenu`, `Textarea`, `Checkbox`, `Switch`, `Label`,
and `cn`.

## The mark

`Logo` is the one component this package owns: three thought bubbles turned
towards a single spark, which is the whole premise of the app. It is drawn in
`currentColor` so it follows the theme, and sized like a Lucide icon so it sits
next to one without looking out of place.

```tsx
import { Logo } from '@internal/ui';

<Logo className="size-5 text-muted-foreground" />;        // decoration
<Logo title="Multi Mind" />;                               // an image with a name
```

The same drawing is the app icon in `apps/desktop/src-tauri/icons`, and the
favicon each window serves from `public/logo.svg`.
