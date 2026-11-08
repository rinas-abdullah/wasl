"use client";
import type { Permission, Role } from "@wasl/shared";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public body?: unknown) {
    super(message);
  }
}

let csrfToken: string | null = null;
export function setCsrf(token: string | null) {
  csrfToken = token;
}

export interface Me {
  user: { id: string; name: string; email: string; isDemo: boolean };
  role: Role;
  permissions: Permission[];
  organization: { id: string; name: string; nameAr: string; isDemo: boolean };
  facility: { id: string; code: string; name: string; nameAr: string; timezone: string };
  carrierId: string | null;
  driverId: string | null;
  csrfToken: string;
  demoMode: boolean;
}

async function request<T>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string; allowStatus?: number[] } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok && !opts.allowStatus?.includes(res.status)) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/login")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "HTTP_ERROR", err.message ?? res.statusText, err.details, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string; allowStatus?: number[] }) => request<T>("POST", path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
};

export function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
