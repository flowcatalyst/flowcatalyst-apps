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
      // `_tag`/`_aggregateType` are Effect's tagged-error / discriminator convention.
      // `__internal` is the convention for test-only exports of file-private helpers.
      'no-underscore-dangle': [
        'error',
        { allow: ['_tag', '_aggregateType', '__esModule', '__internal'] },
      ],
      // Allow `x != null` (matches both null and undefined) — idiomatic in fulfil.
      eqeqeq: ['error', 'smart'],
      // Idiomatic for fixed-size init via `new Array(n).fill(...)`.
      'unicorn/no-new-array': 'off',
      // Pure-type-export files (re-exports of Zod schemas) often look "empty" to oxlint.
      'unicorn/no-empty-file': 'off',
      // In-loop awaits in this codebase are deliberate, not accidental:
      // Redis SCAN/cursor pagination (each call needs the previous cursor),
      // transaction-ordered cascade commits (confirm-master-location), and
      // per-iteration tx isolation in batch handlers (validate-master-locations,
      // where one failure must not abort the batch). Parallelizing any of these
      // would be wrong, and the rest are low-volume admin/seed paths. Off rather
      // than scattered per-line suppressions.
      'no-await-in-loop': 'off',
      // Express-specific rule that fires on every Fastify route handler. Our
      // servers are Fastify, which awaits async handlers and routes errors
      // through onError hooks — the "unhandled rejection" risk this rule
      // guards against doesn't apply.
      'no-async-endpoint-handlers': 'off',
    },
    overrides: [
      {
        // CLI scripts write to stdout/stderr by design; the composition root
        // logs boot diagnostics before the Pino logger exists.
        files: ['apps/*/server/scripts/**', 'apps/*/server/src/app-context.ts'],
        rules: { 'no-console': 'off' },
      },
      {
        // Test files commonly define one-off fixtures (fake refresh/validate
        // callbacks etc.) inside each `it()` for readability. Hoisting them
        // makes tests harder to follow, not easier.
        files: ['**/*.test.ts', '**/test/**'],
        rules: { 'unicorn/consistent-function-scoping': 'off' },
      },
    ],
  },

  // Custom workspace tasks beyond vp build/test/dev/check go here, e.g.:
  //   run: { tasks: { migrate: { command: 'pnpm -F server db:migrate' } } }
  // Pipeline ordering for build/test is inferred from the pnpm dependency graph.
});
