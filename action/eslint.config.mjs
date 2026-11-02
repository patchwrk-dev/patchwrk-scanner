import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  { ignores: ['dist/**'] }, js.configs.recommended, ...tseslint.configs.recommended,
  { languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } } },
);
