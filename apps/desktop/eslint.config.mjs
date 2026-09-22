import reactConfig from '@internal/eslint-config/react';

/** @type {import('eslint').Linter.Config[]} */
export default [...reactConfig, { ignores: ['dist/**', 'src-tauri/**'] }];
