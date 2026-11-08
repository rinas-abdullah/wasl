import { config } from "../config";
import { AppError } from "../http/errors";

/**
 * HTTP client for the Python intelligence service (OR-Tools, SimPy,
 * scikit-learn). Timeouts and bounded retries for transient failures only
 * (network errors / 502-504). 4xx responses are never retried.
 */
export async function intel<T>(path: string, body: unknown, opts: { timeoutMs?: number; retries?: number; method?: "GET" | "POST" } = {}): Promise<T> {
  const { timeoutMs = 30_000, retries = 2, method = "POST" } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${config.intelligenceUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (res.ok) return (await res.json()) as T;
      const text = await res.text();
      if (res.status >= 500 && res.status !== 501 && attempt < retries) {
        lastErr = new Error(`intelligence ${res.status}: ${text}`);
      } else {
        throw new AppError(res.status >= 500 ? 502 : 422, "INTELLIGENCE_ERROR", `Intelligence service error (${res.status}): ${text.slice(0, 500)}`);
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
  }
  const msg = (lastErr as Error)?.name === "AbortError" ? "timed out" : String((lastErr as Error)?.message ?? lastErr);
  throw new AppError(503, "INTELLIGENCE_UNAVAILABLE", `Intelligence service unavailable: ${msg}`);
}

export async function intelHealthy(): Promise<boolean> {
  try {
    await intel("/health", null, { method: "GET", timeoutMs: 2000, retries: 0 });
    return true;
  } catch {
    return false;
  }
}
