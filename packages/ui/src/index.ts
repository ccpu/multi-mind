/**
 * The app's design system is `@pixpilot/shadcn-ui`; this package only re-exports
 * it so every window has a single import surface. Reach for `@pixpilot/shadcn`
 * directly when you need a raw shadcn primitive that the wrapper library does
 * not re-export (`DropdownMenu`, `Textarea`, ...).
 *
 * The one thing it adds is the Multi Mind mark, which both windows draw.
 */
export { Logo } from './logo';
export type { LogoProps } from './logo';
export * from '@pixpilot/shadcn-ui';
