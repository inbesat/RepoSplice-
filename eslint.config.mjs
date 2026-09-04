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
