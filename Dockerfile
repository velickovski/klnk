# syntax=docker/dockerfile:1
# Pin this Node 24 image to a reviewed digest before an actual release.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --workspace=@personal-agent/server --include-workspace-root --no-audit --no-fund
COPY scripts/build-server.ts scripts/build-server.ts
COPY tsconfig.json ./
COPY apps/server/src apps/server/src
COPY apps/server/migrations apps/server/migrations
COPY packages/domain/src packages/domain/src
RUN npm run build:server

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --omit=dev --workspace=@personal-agent/server --include-workspace-root --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 EMBEDDED_WORKER=false DEMO_ENABLED=false LEGACY_ENABLED=false EMAIL_DELIVERY_ENABLED=false LIVE_CALLS_ENABLED=false
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/server ./dist/server
USER node
EXPOSE 4000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/ready');if(!r.ok)process.exit(1)"]
CMD ["node", "dist/server/src/main.js"]
