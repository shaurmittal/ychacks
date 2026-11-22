# Overwatch: one-service deploy (Railway). Builds the Wasp app and serves client + API from one URL.
# Needs at build time: RAILWAY_PUBLIC_DOMAIN (generate a domain first), REACT_APP_ELEVENLABS_AGENT_ID.
# Needs at run time: ANTHROPIC_API_KEY (+ optional ASSIST_MODEL, REPORT_MODEL). Mount a volume at /app/data.

FROM node:24.22.1-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 1) wasp build + client build
FROM base AS wasp-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g @wasp.sh/wasp-cli@0.26.1
WORKDIR /app
COPY . .
# Wasp refuses to build SQLite for production. We have no models (store is data/db.json), so the
# provider is irrelevant at runtime; switch it only inside the image so local `wasp start` is unchanged.
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' schema.prisma
RUN wasp build
ARG RAILWAY_PUBLIC_DOMAIN
ARG REACT_APP_ELEVENLABS_AGENT_ID
RUN test -n "$RAILWAY_PUBLIC_DOMAIN" || (echo "ERROR: generate a public domain for this Railway service, then redeploy" && exit 1)
RUN REACT_APP_API_URL="https://$RAILWAY_PUBLIC_DOMAIN" npx vite build
RUN rm -rf .wasp/out/node_modules .wasp/out/server/node_modules

# 2) bundle the server (mirrors Wasp's generated .wasp/out/Dockerfile)
FROM base AS server-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=wasp-build /app/.wasp/out/src ./src
COPY --from=wasp-build /app/.wasp/out/package.json /app/.wasp/out/package-lock.json ./
COPY --from=wasp-build /app/.wasp/out/tsconfig.src.json ./
COPY --from=wasp-build /app/.wasp/out/server .wasp/out/server
COPY --from=wasp-build /app/.wasp/out/sdk .wasp/out/sdk
COPY --from=wasp-build /app/.wasp/out/types .wasp/out/types
COPY --from=wasp-build /app/.wasp/out/libs .wasp/out/libs
RUN npm install && cd .wasp/out/server && npm install && npm run bundle
RUN mkdir -p .wasp/out/server/node_modules

# 3) runtime
FROM base
ENV NODE_ENV=production \
    CLIENT_BUILD_DIR=/app/client \
    OARLOCK_DATA_DIR=/app/data \
    DATABASE_URL=postgresql://unused:unused@localhost:5432/unused
WORKDIR /app
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/.wasp/out/server/node_modules .wasp/out/server/node_modules
COPY --from=server-build /app/.wasp/out/server/bundle .wasp/out/server/bundle
COPY --from=server-build /app/.wasp/out/server/package.json .wasp/out/server/
COPY --from=wasp-build /app/.wasp/out/db .wasp/out/db
COPY --from=wasp-build /app/.wasp/out/web-app/build ./client
RUN mkdir -p /app/data
WORKDIR /app/.wasp/out/server
# Server + client share the Railway domain unless overridden.
CMD ["sh", "-c", "export WASP_SERVER_URL=\"${WASP_SERVER_URL:-https://$RAILWAY_PUBLIC_DOMAIN}\" WASP_WEB_CLIENT_URL=\"${WASP_WEB_CLIENT_URL:-https://$RAILWAY_PUBLIC_DOMAIN}\"; exec node --enable-source-maps bundle/server.js"]
