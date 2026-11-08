"use client";
import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/lib/session";

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas" aria-busy="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wasl-logo-trim.png" alt="وَصل | WASL" className="h-14 w-auto animate-pulse" />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<Splash />}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
