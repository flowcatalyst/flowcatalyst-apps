import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    ignorePatterns: ['dist/**', '.vite/**', '.vite-plus/**', 'coverage/**', '*.gen.*'],
    singleQuote: true,
    semi: true,
    trailingComma: 'all',
    printWidth: 100,
  },

  lint: {
    ignorePatterns: ['dist/**', '.vite/**', '.vite-plus/**', 'coverage/**', '*.gen.*'],
    options: {
      // type-aware rules off by default — fulfil's branded-ID casts (`x as FulfilmentId`)
      // trip `no-unsafe-type-assertion`. Flip on per-package via lint.overrides when
      // a package is ready to adopt them.
      typeAware: false,
      typeCheck: false,
    },
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'warn',
    },
    rules: {
      'no-console': 'warn',
      'no-floating-promises': 'error',
      // Effect's tagged-error / discriminator convention.
      'no-underscore-dangle': ['error', { allow: ['_tag', '_aggregateType', '__esModule'] }],
      // Allow `x != null` (matches both null and undefined) — idiomatic in fulfil.
      eqeqeq: ['error', 'smart'],
      // Idiomatic for fixed-size init via `new Array(n).fill(...)`.
      'unicorn/no-new-array': 'off',
      // Pure-type-export files (re-exports of Zod schemas) often look "empty" to oxlint.
      'unicorn/no-empty-file': 'off',
      // Sequential awaits in scripts are intentional; flag-only.
      'no-await-in-loop': 'warn',
    },
    overrides: [
      {
        // CLI scripts legitimately write to stdout/stderr.
        files: ['apps/fulfil/server/scripts/**'],
        rules: { 'no-console': 'off' },
      },
    ],
  },

  // Custom workspace tasks beyond vp build/test/dev/check go here, e.g.:
  //   run: { tasks: { migrate: { command: 'pnpm -F server db:migrate' } } }
  // Pipeline ordering for build/test is inferred from the pnpm dependency graph.
});
