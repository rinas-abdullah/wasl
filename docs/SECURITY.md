# Security

Scope: prototype security review of the code in this repository (not a penetration test).

| Area | Implementation | Where |
|---|---|---|
| Passwords | bcrypt (cost 10 seed / 12 new users); timing-equalised failure path; generic error message | `http/auth.ts`, `domain/admin.ts` |
| Sessions | 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `COOKIE_SECURE=true`); only the SHA-256 hash is stored; 12 h default, 14 d with "remember"; logout deletes the row; role change revokes the user's sessions | `http/auth.ts` |
| CSRF | Per-session token required in `X-CSRF-Token` on every mutating request; login requires a JSON body (no simple-form CSRF) and SameSite cookies | `http/route.ts` |
| Rate limiting | Global 600 req/min per user/IP; login 10/min per IP (`RATE_LIMIT_LOGIN`) | `app.ts`, `routes/index.ts` |
| Input validation | Zod on body/query/params for every route; 512 KB body limit | `http/route.ts`, `packages/shared/src/schemas.ts` |
| SQL injection | Drizzle query builder / parameterised `sql` templates only; no string-built SQL from user input | `apps/api/src/**` |
| XSS | React escaping; no `dangerouslySetInnerHTML`; QR SVG is generated server-side from an internal URL; `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` headers | web + `app.ts` |
| RBAC | Permission checked on the server for every route; UI hiding is cosmetic | `http/route.ts`, `permissions.ts` |
| Resource-level authZ / IDOR | Every query filters by the session facility; carriers/drivers additionally by carrier/driver; other tenants' IDs return **404** | `domain/trucks.ts` (`truckScope`), `handover.ts`, `admin.ts` |
| Policy overrides | Only checks marked `overridable` can be overridden, by `release:override` holders, with a ≥10-char reason, recorded in audit; safety/capacity checks are never overridable | `readiness/service.ts` |
| Concurrency | Facility advisory lock + row lock + `EXCLUDE` constraint; optimistic versioning on trucks/reviews; idempotency keys | see ARCHITECTURE |
| Audit integrity | Append-only trigger on `audit_events`; events carry actor, source, correlation id, previous/new state | `0001_integrity.sql` |
| Secure errors | Unknown errors return `INTERNAL_ERROR` + request id; stack traces/SQL only in server logs; cookies/CSRF/passwords redacted from logs | `app.ts` |
| QR handover | QR encodes only a URL with a 192-bit random token; scanning requires an authenticated, authorised session in the same facility; actions are idempotent and state-guarded | `domain/handover.ts` |
| File upload | None (no upload surface) | — |
| Secrets | No secrets in code; `.env.example` files only; demo password configurable via `DEMO_PASSWORD`; seed data contains no real personal data (synthetic names, "(demo)" plates, no phone numbers) | `apps/api/.env.example` |
| Demo safety | `DEMO_MODE` + `is_demo` guard on reset; seeded demo accounts cannot have roles changed in demo mode; ORGANIZATION_ADMIN cannot grant SUPER_ADMIN/ORG_ADMIN; no demo account is SUPER_ADMIN | `domain/admin.ts` |
| Dependencies | `npm audit` reported 0 vulnerabilities at install time; Python deps pinned by major range | `package-lock.json`, `requirements.txt` |
| CSV export | Formula-injection characters (`= + - @`) are prefixed | `analytics.ts#toCsv` |

## Verified by tests

`apps/api/test/integration.test.ts` covers: wrong password, unauthenticated access, cookie flags, missing CSRF, auditor/carrier forbidden actions, driver IDOR (404), tenant isolation for trucks/docks/handover tokens, carrier creating for another carrier, non-overridable override attempt, concurrent releases, DB-level double booking, audit UPDATE/DELETE rejection, idempotent replay and duplicate handover.

## Known gaps / before any real deployment

* Set `COOKIE_SECURE=true` and serve over HTTPS; change `DEMO_PASSWORD` or disable seeding (`SEED_DEMO_ON_START=false`).
* No MFA, password reset or account lockout beyond rate limiting.
* No Content-Security-Policy header yet (Next.js inline runtime would need nonces).
* SSE and rate-limit state are per API process.
* The intelligence service has no authentication: it must stay on an internal network (as in the Compose file, where it publishes no port).
