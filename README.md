# وَصل | WASL

**AI-powered logistics digital twin & decision intelligence for truck reception** — a Naqlthon 5 prototype.

> «وجود موعد مؤكد للشاحنة لا يعني بالضرورة أن المنشأة جاهزة لاستقبالها»
> A confirmed appointment does not mean the facility is ready to receive the truck.

WASL links truck arrivals to the facility's real capacity to serve them, through one decision loop:

**Predict → Optimize → Simulate → Verify → Release → Learn**

| Step | What actually runs |
|---|---|
| Predict | scikit-learn service-time regressor and congestion-risk classifier, trained on a *declared* synthetic process, evaluated against baselines ([`services/intelligence/wasl_intel/ml.py`](services/intelligence/wasl_intel/ml.py)) |
| Optimize | Google OR-Tools CP-SAT: dock, crew and start-time assignment under compatibility, no-overlap, shift, equipment, inspector and yard constraints ([`optimizer.py`](services/intelligence/wasl_intel/optimizer.py)) |
| Simulate | SimPy discrete-event model comparing FCFS, fixed appointments, OR-only and full WASL, with seeds, versions and event logs stored ([`simulation.py`](services/intelligence/wasl_intel/simulation.py)) |
| Verify | Server-side Readiness-to-Release engine: 13 checks with evidence, policy-based overrides ([`engine.ts`](apps/api/src/domain/readiness/engine.ts)) |
| Release | Atomic reservation of dock + crew + equipment in one transaction; a Postgres `EXCLUDE` constraint makes double booking impossible ([`service.ts`](apps/api/src/domain/readiness/service.ts), [`0001_integrity.sql`](apps/api/drizzle/0001_integrity.sql)) |
| Learn | Actual vs. estimated service times are recorded and reported; retraining on real data is **not implemented** (no real data exists) |

Everything runs on **synthetic data**. Sensors are **100% virtual**. No real warehouse is connected.

## Quick start (Docker)

```bash
docker compose -f infrastructure/docker-compose.yml up --build
```

Open <http://localhost:3000> and sign in with a demo account (password `Wasl@Demo2026` unless you set `DEMO_PASSWORD`):
`ops@demo.wasl.sa`, `dock@demo.wasl.sa`, `quality@demo.wasl.sa`, `admin@demo.wasl.sa`, `carrier@demo.wasl.sa`, `driver@demo.wasl.sa`, `auditor@demo.wasl.sa`.
See [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) for the 10-minute judge walkthrough.

## Local development

Requirements: Node ≥ 20, Python ≥ 3.11, PostgreSQL 16.

```bash
npm install
pip install -r services/intelligence/requirements-dev.txt
cp apps/api/.env.example apps/api/.env            # set DATABASE_URL / DEMO_PASSWORD
(cd services/intelligence && python -m wasl_intel.train && uvicorn wasl_intel.app:app --port 8000)
npm run db:migrate && npm run db:seed
npm run dev:api        # http://localhost:4000  (OpenAPI UI at /api/docs)
npm run dev:web        # http://localhost:3000
```

## Repository layout

```
wasl/
  apps/api                Fastify + TypeScript API, Drizzle ORM, PostgreSQL, job worker, SSE
  apps/web                Next.js 16 (App Router) + React 19 + Tailwind 4 + TanStack Query/Table
  packages/shared         Domain enums, state machines, permissions, Zod schemas (used by API and web)
  services/intelligence   FastAPI: OR-Tools optimiser, SimPy simulator, scikit-learn models
  infrastructure          Docker Compose
  tests/e2e               Playwright acceptance journey
  scripts                 Reproducible experiment runner
  docs                    Architecture, database, API, security, deployment, demo, testing, methodology
```

## Documentation

[ARCHITECTURE](docs/ARCHITECTURE.md) · [DATABASE](docs/DATABASE.md) · [API](docs/API.md) · [SECURITY](docs/SECURITY.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [DEMO_GUIDE](docs/DEMO_GUIDE.md) · [TESTING](docs/TESTING.md) · [METHODOLOGY](docs/METHODOLOGY.md) · [EXPERIMENTS](docs/EXPERIMENTS.md) · [FEATURES & limitations](docs/FEATURES.md)

## Status

This is a working prototype, not a production-ready system. What is implemented and verified, and what is not, is listed honestly in [docs/FEATURES.md](docs/FEATURES.md).
