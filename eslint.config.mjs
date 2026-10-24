import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { prettier },
    rules: {
      'prettier/prettier': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['axios', 'node-fetch', 'ky', 'got'], message: 'Use fetch or ofetch' },
            {
              group: ['prisma', 'drizzle-orm', 'typeorm', 'sequelize', 'knex'],
              message: 'Use raw SQLite',
            },
            { group: ['jest', '@jest/*'], message: 'Use Vitest' },
            { group: ['webpack', 'rollup', 'esbuild'], message: 'Use bun build / tsup' },
            {
              group: ['redux', '@reduxjs/*', 'mobx', 'recoil', 'jotai'],
              message: 'Use Zustand + TanStack Query',
            },
            { group: ['moment', 'date-fns'], message: 'Use Temporal polyfill' },
            { group: ['joi', 'yup', 'class-validator'], message: 'Use Zod' },
            { group: ['socket.io', 'ws'], message: 'Use native WebSocket' },
            { group: ['better-sqlite3'], message: 'Use bun:sqlite' },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-throw-literal': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // P-236 — tests must not leak console.error. The rule targets CALLS
    // only, so `expect(console.error).toHaveBeenCalled()` stays legal.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='console'][callee.property.name='error']",
          message: 'Do not call console.error in tests — assert on it instead (see P-236).',
        },
        {
          // P-253 — a focused test must never be committed: it silently hides
          // every other case in the file from the run.
          selector:
            "MemberExpression[object.name='it'][property.name='only'], MemberExpression[object.name='test'][property.name='only'], MemberExpression[object.name='describe'][property.name='only']",
          message:
            'Do not commit a focused test (it.only / test.only / describe.only) — see TESTING.md.',
        },
        {
          // P-253 — a skipped test needs a reason that outlives the author:
          // `// skip-ok: <issue URL or #123>` beside it, plus an eslint-disable.
          selector:
            "MemberExpression[object.name='it'][property.name='skip'], MemberExpression[object.name='test'][property.name='skip'], MemberExpression[object.name='describe'][property.name='skip']",
          message:
            'A skipped test needs a linked issue: add `// skip-ok: <issue URL or #123>` and an eslint-disable-next-line — see TESTING.md.',
        },
      ],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.*',
      '*.md',
    ],
  }
);
