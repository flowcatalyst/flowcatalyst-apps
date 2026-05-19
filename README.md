# flowcatalyst-apps

TypeScript monorepo for apps running on [FlowCatalyst](https://github.com/yourusername/flowcatalyst) with [Effect](https://effect.website) v4.

## Stack

| Concern        | Choice                                |
| -------------- | ------------------------------------- |
| Runtime        | Node.js 24 LTS                        |
| Package mgr    | pnpm 11 (workspaces + catalogs)       |
| Language       | TypeScript 6 (strict, NodeNext)       |
| Toolchain      | Vite+ (lint, fmt, test, build, tasks) |
| Effect runtime | Effect 4.0.0-beta                     |
| FC SDK         | `@flowcatalyst/sdk` via file: link    |

## Layout

```
flowcatalyst-apps/
├─ apps/
│  └─ fulfil/                     # nested sub-monorepo (server, framework, …)
└─ packages/
   ├─ tsconfig/                   # @flowcatalyst-apps/tsconfig
   └─ testing/                    # @flowcatalyst-apps/testing
```

## Setup

```bash
# 1. Install Vite+ global CLI (one-time)
curl -fsSL https://vite.plus | bash

# 2. Install dependencies (vp install delegates to pnpm)
pnpm install

# 3. Verify
vp check       # lint + format + typecheck
vp test        # run all tests
```

## Daily commands

Use `vp` for the wrapped tasks, pnpm for dep management.

### `vp` — primary toolchain

| Command          | What it does                                  |
| ---------------- | --------------------------------------------- |
| `vp dev`         | Run dev tasks across the workspace            |
| `vp build`       | Build everything (cached, dependency-ordered) |
| `vp test`        | Vitest across the workspace                   |
| `vp check`       | oxlint + oxfmt + type-check                   |
| `vp check --fix` | Auto-fix format and lint                      |
| `vp run <task>`  | Run a named task with caching + topo order    |

### `pnpm` — dependency management

`vp` doesn't wrap these — keep using pnpm directly.

| Command                     | What it does                              |
| --------------------------- | ----------------------------------------- |
| `pnpm install`              | Install everything                        |
| `pnpm add <pkg>` / `-D`     | Add a dep (use `-w` for the root)         |
| `pnpm add -F <name> <pkg>`  | Add a dep to a specific workspace package |
| `pnpm remove <pkg>`         | Remove a dep                              |
| `pnpm update <pkg>`         | Bump a dep                                |
| `pnpm why <pkg>`            | See who pulls in a package                |
| `pnpm outdated -r`          | Check for outdated deps workspace-wide    |
| `pnpm -F <name> <script>`   | Run a script in one package               |
| `pnpm -F <name> exec <cmd>` | Run a command inside a package's context  |

> The catalog (`pnpm-workspace.yaml`) is the source of truth for shared versions — TypeScript, Effect, Vitest, Vite+, `@types/node`. Edit there to bump everything at once; don't pin in individual `package.json`s. A `legacy` catalog exists for apps that can't move to the latest beta yet.

## Adding a new app

1. `mkdir apps/<name> && cd apps/<name>`
2. Create `package.json` with `"name": "@flowcatalyst-apps/<name>"`, depend on `"@flowcatalyst/sdk": "file:../../../flowcatalyst-rust/clients/typescript-sdk"` and `"effect": "catalog:"`.
3. Extend `@flowcatalyst-apps/tsconfig/node.json` in `tsconfig.json`.
4. For tests, import from `@flowcatalyst-apps/testing`.

## Config sources

| Lives in              | Controls                                     |
| --------------------- | -------------------------------------------- |
| `vite.config.ts`      | fmt (oxfmt), lint (oxlint), tasks (`vp run`) |
| `pnpm-workspace.yaml` | workspace packages, catalogs, allowBuilds    |
| `packages/tsconfig/*` | TypeScript compiler options                  |

Don't create `.oxfmtrc.json` or `oxlint.json` — Vite+ reads fmt/lint settings from `vite.config.ts` directly.

## Shared packages

- **`@flowcatalyst-apps/tsconfig`** — `base.json`, `node.json`, `lib.json`. Strict TS 6, NodeNext, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. Apps extend one of these and add `rootDir` / `outDir`.
- **`@flowcatalyst-apps/testing`** — `defineVitestConfig()` for standardised Vitest config, plus Effect test helpers (`runTest`, `runTestWith`, `expectEffectFailure`).

Domain types come from `@flowcatalyst/sdk`; we only add a shared package here when something genuinely cross-cuts the apps.

## FlowCatalyst SDK

The SDK isn't published to npm. Apps depend on it via:

```json
"@flowcatalyst/sdk": "file:../../../flowcatalyst-rust/clients/typescript-sdk"
```

When the SDK lands in a git remote, this can become `"github:org/repo#path:clients/typescript-sdk"`.

## A note on Vite+

Vite+ is **0.1.21 alpha** (March 2026 release). The CLI surface may shift before 1.0. Where possible, scripts in `package.json` invoke `vp` so `pnpm run check` and `vp check` behave identically — pick whichever feels right. If `vp` ever breaks, fall back to the underlying tools (`vitest`, `oxlint`, `oxfmt`, `tsc`) directly.
