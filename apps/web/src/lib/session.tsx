"use client";
import { createContext, useContext, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Permission } from "@wasl/shared";
import { api, setCsrf, type Me } from "./api";

const SessionCtx = createContext<Me | null>(null);

export function SessionProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/auth/me"), staleTime: 60_000 });
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
