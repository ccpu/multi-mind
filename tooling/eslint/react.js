import makeReactConfig from '@pixpilot/eslint-config-react';

/**
 * @type {Awaited<ReturnType<typeof makeReactConfig>>}
 */
// eslint-disable-next-line antfu/no-top-level-await
const reactConfig = await makeReactConfig({
  pnpm: false,
  turbo: true,
});

export default reactConfig;
