/**
 * The handful of values that describe the app rather than configure it.
 *
 * Anything the user can change belongs in `AppSettings`, which lives in the
 * settings file; this is only what both windows have to agree on before there
 * is a settings file to read.
 */
export const appConfig = {
  name: 'Multi Mind',
  description:
    'One prompt box driving several AI chat sites side by side, ported from the original WinForms app.',
  author: {
    name: 'CCPU',
    email: 'contact@example.com',
  },
  // Theme configuration
  theme: {
    enabled: true, // Set to false to disable theme switching
    defaultTheme: 'system', // 'light', 'dark', or 'system'
  },
};
