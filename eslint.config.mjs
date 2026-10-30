import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars':        ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any':        'error',
      // Codebase idioms: `!` after indexed access under noUncheckedIndexedAccess, numbers in GLSL/log
      // templates, and no-op lifecycle methods (init/destroy/flush) that satisfy node/sink interfaces.
      '@typescript-eslint/no-non-null-assertion':  'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-empty-function':      'off',
      // Render and playback loops are written as `while (true)` with explicit breaks.
      '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
    },
  },
  {
    // Zustand store actions are closures, not `this`-bound methods.
    files: ['packages/studio/**'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    // Tool configs and tests that no package tsconfig includes: lint without type information.
    files: ['**/*.config.ts', '**/*.test.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.mjs', 'packages/types/src/index.d.ts'],
  }
)
