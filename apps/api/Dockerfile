# syntax=docker/dockerfile:1
# Build context: repository folder `wasl/`
FROM node:22-alpine AS build
WORKDIR /app
# Optional build-time CA certificates (see infrastructure/certs/README.md)
COPY infrastructure/certs/ /tmp/certs/
RUN cat /tmp/certs/*.crt > /tmp/extra-ca.pem 2>/dev/null; true
ENV NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @wasl/api -w @wasl/shared --include-workspace-root --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @wasl/api && npm prune --omit=dev -w @wasl/api -w @wasl/shared --include-workspace-root

FROM node:22-alpine
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0 MIGRATIONS_DIR=/app/apps/api/drizzle
WORKDIR /app
RUN addgroup -S wasl && adduser -S wasl -G wasl
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY apps/api/docker-entrypoint.sh /usr/local/bin/wasl-api
RUN chmod +x /usr/local/bin/wasl-api
USER wasl
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["wasl-api"]
