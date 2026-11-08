# syntax=docker/dockerfile:1
# Build context: repository folder `wasl/`
FROM node:22-alpine AS build
WORKDIR /app
# Optional build-time CA certificates (see infrastructure/certs/README.md)
COPY infrastructure/certs/ /tmp/certs/
RUN cat /tmp/certs/*.crt > /tmp/extra-ca.pem 2>/dev/null; true
ENV NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @wasl/web -w @wasl/shared --include-workspace-root --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @wasl/web

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=http://api:4000
WORKDIR /app
RUN addgroup -S wasl && adduser -S wasl -G wasl
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER wasl
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT}/login >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
