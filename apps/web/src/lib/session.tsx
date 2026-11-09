"use client";
import { createContext, useContext, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Permission } from "@wasl/shared";
import { api, ApiError, NO_AUTO_DEMO_KEY, setCsrf, type DemoAccount, type Me } from "./api";

const SessionCtx = createContext<Me | null>(null);

/**
 * Loads the session. Without one, in demo mode, signs the visitor in automatically as the
 * demo operations manager so the platform opens directly (switching role or signing in with
 * an email account is available from the top bar). After an explicit sign-out, or outside
 * demo mode, the visitor is sent to /login instead.
 */
async function loadSession(): Promise<Me> {
  try {
    return await api.get<Me>("/api/auth/me", { noAuthRedirect: true });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    let optedOut = false;
    try {
      optedOut = sessionStorage.getItem(NO_AUTO_DEMO_KEY) === "1";
    } catch {
      /* storage unavailable */
    }
    if (!optedOut) {
      const accounts = await api.get<DemoAccount[]>("/api/auth/demo-accounts", { noAuthRedirect: true }).catch(() => [] as DemoAccount[]);
      const pick = accounts.find((a) => a.role === "OPERATIONS_MANAGER") ?? accounts[0];
      if (pick) {
        await api.post("/api/auth/demo-login", { email: pick.email }, { noAuthRedirect: true });
        return await api.get<Me>("/api/auth/me", { noAuthRedirect: true });
      }
    }
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw e;
  }
}

export function SessionProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const { data } = useQuery({ queryKey: ["me"], queryFn: loadSession, staleTime: 60_000, retry: false });
  useEffect(() => {
    if (data) setCsrf(data.csrfToken);
  }, [data]);
  if (!data) return <>{fallback}</>;
  setCsrf(data.csrfToken);
  return <SessionCtx.Provider value={data}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export function useCan() {
  const s = useSession();
  return (p: Permission) => s.permissions.includes(p);
}
