# syntax=docker/dockerfile:1.7
# ── Multi-stage build for pinpoint (server + Vue SPA, one image) ──
# Build context: the TS workspace root. Always invoke with
# `-f apps/pinpoint/Dockerfile` from `/Users/.../flowcatalyst-apps/typescript/`
# so pnpm sees the workspace. (Or via `docker compose -f
# apps/pinpoint/compose.prod.yaml up --build` from the same dir — the
# compose `context: ../..` resolves to the TS workspace root.)

# Stage 1 ── install + build ───────────────────────────────────────
FROM node:24-alpine AS build
# git is needed because @flowcatalyst/sdk resolves via github:flowcatalyst/typescript-sdk
# — pnpm `git ls-remote`s the tags during install + deploy.
RUN apk add --no-cache git \
    && corepack enable \
    && corepack prepare pnpm@11.1.2 --activate
WORKDIR /workspace

# Copy the entire workspace. We can't cherry-pick package.json files for
# layer caching because pnpm's deps graph touches every workspace member.
# (If image build time becomes a problem, switch to a multi-step approach
# that copies all package.json files first, runs install, then copies src.)
COPY . .

# Cache pnpm's content-addressed store between builds when BuildKit is on.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Build the SPA first (its tsc run is shorter; fails fast).
RUN pnpm --filter @pinpoint/web build
# Workspace deps need to be compiled to dist/ so the runtime image can
# resolve them as JS. Their exports map points at dist via the `compiled`
# condition (which node enables in the runtime CMD), and at src via
# `default` so tsx-driven local dev keeps using source TS.
RUN pnpm --filter @pinpoint/server... --filter @pinpoint/framework... \
        --filter @pinpoint/shared --filter @flowcatalyst-apps/app-framework \
        build

# `pnpm deploy` produces a self-contained directory with the server's
# compiled output + a `node_modules/` that has every workspace dep
# inlined as a real folder (not a symlink). Drop dev deps with --prod.
# pnpm 11+ blocks git-resolved subdeps by default; @flowcatalyst/sdk reaches
# @pinpoint/server transitively via @pinpoint/framework, so opt out here.
RUN pnpm config set block-exotic-subdeps false --location project \
    && pnpm --filter @pinpoint/server --prod --legacy deploy /deploy/server

# Stage 2 ── runtime ────────────────────────────────────────────────
FROM node:24-alpine AS runtime
RUN addgroup -S pinpoint && adduser -S -G pinpoint pinpoint
WORKDIR /app

# Deployed server bundle (dist + node_modules + drizzle/ migrations).
COPY --from=build --chown=pinpoint:pinpoint /deploy/server ./server

# SPA `dist` served as static via @fastify/static when
# PINPOINT_WEB_DIST_DIR points at it (the default below).
COPY --from=build --chown=pinpoint:pinpoint /workspace/apps/pinpoint/web/dist ./web/dist

USER pinpoint
WORKDIR /app/server

ENV NODE_ENV=production
ENV PINPOINT_WEB_DIST_DIR=/app/web/dist
ENV PORT=3000
EXPOSE 3000

# Workspace deps (@pinpoint/framework, @pinpoint/shared,
# @flowcatalyst-apps/app-framework) export `compiled: ./dist/index.js`
# alongside `default: ./src/index.ts` so tsx-driven local dev keeps using
# source TS; in prod we opt into the compiled-JS branch with this flag.
CMD ["node", "--conditions=compiled", "dist/server.js"]
