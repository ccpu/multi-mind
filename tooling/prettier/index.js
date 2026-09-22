import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import prettierConfig from '@pixpilot/dev-config/prettier';

const require = createRequire(import.meta.url);

/**
 * Prettier resolves plugin names from the directory it is run in, and the
 * plugin is a dependency of this package rather than of every consumer, so it
 * is handed over as an absolute path.
 */
const tailwindPlugin = require.resolve('prettier-plugin-tailwindcss');

/** @typedef {import("prettier").Config} PrettierConfig */

/**
 * Tailwind v4 keeps the theme in CSS, so the class sorter has to be pointed at
 * the stylesheet. This config is shared through `"prettier":
 * "@internal/prettier-config"` in each package.json, which is what Prettier
 * treats as the config file, so a relative path would resolve differently in
 * every package - hence the absolute one.
 */
const tailwindStylesheet = fileURLToPath(
  new URL('../tailwind/globals.css', import.meta.url),
);

/** @type { PrettierConfig } */
const config = {
  ...prettierConfig,
  plugins: [...(prettierConfig.plugins ?? []), tailwindPlugin],
  tailwindStylesheet,
  tailwindFunctions: ['cn', 'cva'],
  overrides: [
    {
      files: '*.json.hbs',
      options: {
        parser: 'json',
      },
    },
    {
      files: '*.js.hbs',
      options: {
        parser: 'babel',
      },
    },
  ],
};

export default config;
