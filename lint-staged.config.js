module.exports = {
  '*.{ts,tsx}': () => ['pnpm run typecheck'],
  '*.{ts,tsx,js,jsx,yml,yaml,json}': () => ['pnpm run lint:fix', 'pnpm run format:fix'],
  '*.rs': () => ['pnpm run rust:fmt:fix'],
};
