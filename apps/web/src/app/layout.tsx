import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "وَصل | WASL", template: "%s · وَصل | WASL" },
  description: "WASL — Logistics digital twin and decision intelligence for truck reception (prototype with synthetic data).",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await cookies()).get("wasl_locale")?.value === "en" ? "en" : "ar";
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
