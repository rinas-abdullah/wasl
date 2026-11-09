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
  const q = useQuery({
    queryKey: ["me"],
    queryFn: loadSession,
    staleTime: 60_000,
    // The free API tier sleeps when idle and needs ~1 minute to wake: keep retrying on server/network errors.
    retry: (n, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && n < 20,
    retryDelay: 3000,
  });
  const data = q.data;
  useEffect(() => {
    if (data) setCsrf(data.csrfToken);
  }, [data]);
  if (!data) {
    if (q.isError) {
      return (
        <div className="grid min-h-screen place-items-center bg-canvas px-6 text-center">
          <div>
            <p className="text-sm font-medium text-ink">تعذر الاتصال بالخادم · Could not reach the server</p>
            <button onClick={() => q.refetch()} className="mt-4 rounded-lg bg-navy-800 px-4 py-2 text-[13px] font-medium text-white">إعادة المحاولة · Retry</button>
          </div>
        </div>
      );
    }
    return (
      <>
        {fallback}
        {q.failureCount > 0 ? (
          <p className="fixed inset-x-0 bottom-10 text-center text-[12px] text-muted">
            الخادم يستيقظ من وضع السكون، قد يستغرق ذلك دقيقة… · Waking the server, this can take a minute… ({q.failureCount})
          </p>
        ) : null}
      </>
    );
  }
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
