"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { LocaleProvider, type Locale } from "@/lib/i18n";
import { ApiError } from "@/lib/api";

export function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2 },
        },
      }),
  );
  return (
    <LocaleProvider locale={locale}>
      <QueryClientProvider client={qc}>
        {children}
        <Toaster position={locale === "ar" ? "bottom-left" : "bottom-right"} dir={locale === "ar" ? "rtl" : "ltr"} richColors closeButton />
      </QueryClientProvider>
    </LocaleProvider>
  );
}
