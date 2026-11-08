function bool(v: string | undefined, def: boolean) {
  if (v === undefined || v === "") return def;
  return v === "true" || v === "1";
}

/** Accepts "host:port" (e.g. platform-provided internal addresses) as well as full URLs. */
function withScheme(v: string, scheme: string) {
  if (/^https?:\/\//.test(v)) return v.replace(/\/$/, "");
  // "host:port" → internal plain HTTP; bare public host names → HTTPS
  return /:\d+$/.test(v) ? `http://${v}` : `${scheme === "http" ? "https" : scheme}://${v}`;
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/wasl",
  intelligenceUrl: withScheme(process.env.INTELLIGENCE_URL ?? "http://localhost:8000", "http"),
  appPublicUrl: withScheme(process.env.APP_PUBLIC_URL ?? "http://localhost:3000", "https"),
  demoMode: bool(process.env.DEMO_MODE, true),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  intelligenceKey: process.env.INTELLIGENCE_API_KEY ?? "",
  logLevel: process.env.LOG_LEVEL ?? "info",
  sessionTtlHours: 12,
  rememberTtlDays: 14,
  disableWorker: bool(process.env.DISABLE_WORKER, false),
  rateLimitLogin: Number(process.env.RATE_LIMIT_LOGIN ?? 10),
};
