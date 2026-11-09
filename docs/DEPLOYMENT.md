# Deployment

## Local (Docker Compose) — verified

```bash
cd wasl
docker compose -f infrastructure/docker-compose.yml up --build
```

Services: `postgres` (internal), `intelligence` (internal, models trained at image build with a fixed seed), `api` (runs migrations, seeds the demo organisation if missing, starts the HTTP server + job worker), `web` (Next.js standalone, port `${WEB_PORT:-3000}`). Health checks gate start-up order. This stack was built and run in the development environment and the Playwright acceptance journey passed against it.

Variables: `WEB_PORT`, `POSTGRES_PASSWORD`, `DEMO_PASSWORD`, `APP_PUBLIC_URL` (used in QR links), `COOKIE_SECURE`.

Behind a TLS-intercepting proxy, put the proxy's root CA (`*.crt`) into `infrastructure/certs/` before building (used only at build time, git-ignored).

## Render (one-click Blueprint)

[`render.yaml`](../render.yaml) at the repository root defines the whole stack: managed Postgres 16, `wasl-intelligence`, `wasl-api`, `wasl-web` (Docker). Open `https://render.com/deploy?repo=<your repository URL>`, connect GitHub if asked, and click **Apply**. The web URL will be `https://wasl-web.onrender.com` (or a suffixed variant if that name is taken).

* Services reach each other over their public HTTPS hosts; the intelligence service only answers requests carrying the generated `INTELLIGENCE_API_KEY`.
* The web app proxies `/api/*` to `API_INTERNAL_URL` **at runtime** (`apps/web/src/app/api/[...path]/route.ts`), so the same image works on any host.
* Free plans sleep after ~15 minutes idle (first request then takes about a minute, and queued jobs wait for the API to wake) and the free database expires after 30 days. Switch plans in `render.yaml` for a permanent demo.
* `DEMO_PASSWORD` defaults to the documented demo password; change it in the Render dashboard if the demo should not be open.

## Other production options

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

## Vercel (web only)

Import the repository in Vercel with **Root Directory** `apps/web` and the environment variable `API_INTERNAL_URL` set to the public API URL (for example `https://wasl-api.onrender.com`). `apps/web/vercel.json` installs the workspace from the repository root. The API, intelligence service and database must run elsewhere (e.g. Render): Vercel does not host the long-running API worker or the Python solver.

## Railway (API + intelligence + Postgres; web on Vercel)

Railway keeps services running (no sleep on paid usage). Config files: `infrastructure/railway/api.json`, `infrastructure/railway/intelligence.json`.

1. New Project → **Deploy from GitHub repo** → `wasl` (creates one service) and **+ New → Database → PostgreSQL**.
2. Service **intelligence**: Variables `RAILWAY_DOCKERFILE_PATH=services/intelligence/Dockerfile`, `PORT=8000`, `WEB_CONCURRENCY=1`, `INTELLIGENCE_API_KEY=<random string>`; Networking → *Generate Domain* (HTTP, not TCP proxy).
3. Service **api** (+ New → GitHub repo → `wasl` again): Variables:
   `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`, `PORT=4000`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `INTELLIGENCE_URL=${{intelligence.RAILWAY_PUBLIC_DOMAIN}}`, `INTELLIGENCE_API_KEY=${{intelligence.INTELLIGENCE_API_KEY}}`, `DEMO_MODE=true`, `SEED_DEMO_ON_START=true`, `DEMO_PASSWORD=Wasl@Demo2026`, `COOKIE_SECURE=true`, `APP_PUBLIC_URL=https://<your vercel domain>`; Networking → *Generate Domain*.
4. Vercel → project → Settings → Environment Variables: `API_INTERNAL_URL=https://<api railway domain>` → Redeploy.

`RAILWAY_DOCKERFILE_PATH` selects the Dockerfile reliably; the `infrastructure/railway/*.json` config-as-code files also work but Railway is deprecating that feature.

`INTELLIGENCE_URL` may be a bare host name (HTTPS is assumed) or `host:port` (plain HTTP, e.g. a private network address).
