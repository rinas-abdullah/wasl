function bool(v: string | undefined, def: boolean) {
  if (v === undefined || v === "") return def;
  return v === "true" || v === "1";
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/wasl",
  intelligenceUrl: process.env.INTELLIGENCE_URL ?? "http://localhost:8000",
  appPublicUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
  demoMode: bool(process.env.DEMO_MODE, true),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  logLevel: process.env.LOG_LEVEL ?? "info",
  sessionTtlHours: 12,
  rememberTtlDays: 14,
  disableWorker: bool(process.env.DISABLE_WORKER, false),
  rateLimitLogin: Number(process.env.RATE_LIMIT_LOGIN ?? 10),
};
