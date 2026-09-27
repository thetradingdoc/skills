# Blanko — single service: Vite client + Express API
# Cloud Run / Railway: multi-stage build

FROM node:22-bookworm-slim AS client-build
WORKDIR /app/webapp/client
COPY webapp/client/package.json webapp/client/package-lock.json ./
RUN npm ci
COPY webapp/client/ ./
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
RUN npm run build

FROM node:22-bookworm-slim AS server-build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# Server bundles import repo-root src/ and scripts/ (paths ../../../…)
COPY package.json package-lock.json ./
COPY src ./src
COPY scripts ./scripts
COPY webapp/shared ./webapp/shared
COPY webapp/server/package.json webapp/server/package-lock.json ./webapp/server/
WORKDIR /app/webapp/server
RUN npm ci
COPY webapp/server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    CLIENT_DIST_PATH=/app/webapp/client/dist \
    PROJECT_ROOT=/app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=server-build /app/webapp/server/package.json /app/webapp/server/package-lock.json ./webapp/server/
COPY --from=server-build /app/webapp/server/node_modules ./webapp/server/node_modules
COPY --from=server-build /app/webapp/server/dist ./webapp/server/dist
# Runtime may still resolve some scripts relative to PROJECT_ROOT
COPY --from=server-build /app/src ./src
COPY --from=server-build /app/scripts ./scripts
COPY --from=client-build /app/webapp/client/dist ./webapp/client/dist
COPY reference-model.json resources.classify.json ./
WORKDIR /app/webapp/server
EXPOSE 8080
CMD ["node", "dist/index.js"]
