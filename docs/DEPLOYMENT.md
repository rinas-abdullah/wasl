# Deployment

## Local (Docker Compose) — verified

```bash
cd wasl
docker compose -f infrastructure/docker-compose.yml up --build
```

Services: `postgres` (internal), `intelligence` (internal, models trained at image build with a fixed seed), `api` (runs migrations, seeds the demo organisation if missing, starts the HTTP server + job worker), `web` (Next.js standalone, port `${WEB_PORT:-3000}`). Health checks gate start-up order. This stack was built and run in the development environment and the Playwright acceptance journey passed against it.

Variables: `WEB_PORT`, `POSTGRES_PASSWORD`, `DEMO_PASSWORD`, `APP_PUBLIC_URL` (used in QR links), `COOKIE_SECURE`.

Behind a TLS-intercepting proxy, put the proxy's root CA (`*.crt`) into `infrastructure/certs/` before building (used only at build time, git-ignored).

## Production options (not deployed)

No public deployment was made from this environment. A suitable topology:

| Component | Option | Notes |
|---|---|---|
| Web | Vercel, or the `apps/web` container on any container host | Set `API_INTERNAL_URL` **at build time** (rewrites are compiled into the build) |
| API | Container service (Fly.io, Render, Railway, AWS ECS/App Runner, Azure Container Apps) | Long-lived process required (SSE + job worker); keep a single replica unless SSE is moved to LISTEN/NOTIFY |
| Intelligence | Same container platform, private networking only | CPU-bound: ≥2 vCPU recommended for CP-SAT |
| Database | Managed PostgreSQL 16 with the `btree_gist` extension (Neon, Supabase, RDS, Azure Flexible Server) | `btree_gist` is required by the reservation exclusion constraint |

None of these are assumed to be free. Production checklist: HTTPS + `COOKIE_SECURE=true`; strong `DEMO_PASSWORD` or `SEED_DEMO_ON_START=false` and `DEMO_MODE=false`; restrict the intelligence service to the private network; database backups; log shipping (API logs are JSON via pino; intelligence logs are JSON lines).

## Health endpoints

* API: `GET /api/health` → `{ status: ok|degraded|down, database, intelligence }` (degraded = intelligence unreachable; the API still works and falls back to declared planning tables for estimates, while optimisation/simulation jobs fail visibly).
* Intelligence: `GET /health`.
