import next from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier'

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'src/generated/**', 'coverage/**'],
  },
  ...next,
  ...nextTypescript,
  {
    rules: {
      // Unused args are usually a signal, but `_`-prefixed ones are a
      // deliberate "this exists to satisfy a signature" marker.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // Must stay last: turns off every stylistic rule Prettier already owns.
  prettier,
]

export default config
