"use client";
import { createContext, useCallback, useContext, useMemo } from "react";

export type Locale = "ar" | "en";
const LocaleCtx = createContext<Locale>("ar");

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleCtx.Provider value={locale}>{children}</LocaleCtx.Provider>;
}

export function useLocale() {
  return useContext(LocaleCtx);
}

/** Bilingual string helper: t("نص", "Text"). Keeps both languages next to each other at the call site. */
export function useT() {
  const locale = useLocale();
  return useCallback((ar: string, en: string) => (locale === "ar" ? ar : en), [locale]);
}

export function setLocale(locale: Locale) {
  document.cookie = `wasl_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

export function useFormat() {
  const locale = useLocale();
  const tz = "Asia/Riyadh";
  return useMemo(() => {
    // Latin digits in both languages (common in Saudi enterprise software), localised month/day names.
    const tag = locale === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB";
    const time = new Intl.DateTimeFormat(tag, { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const dateTime = new Intl.DateTimeFormat(tag, { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const date = new Intl.DateTimeFormat(tag, { timeZone: tz, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    const num = new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { maximumFractionDigits: 1 });
    const pct = new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { style: "percent", maximumFractionDigits: 0 });
    const rel = new Intl.RelativeTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en", { numeric: "auto" });
    const parse = (d: string | Date | null | undefined) => (d ? (typeof d === "string" ? new Date(d) : d) : null);
    return {
      tz,
      time: (d?: string | Date | null) => (parse(d) ? time.format(parse(d)!) : "—"),
      dateTime: (d?: string | Date | null) => (parse(d) ? dateTime.format(parse(d)!) : "—"),
      date: (d?: string | Date | null) => (parse(d) ? date.format(parse(d)!) : "—"),
      num: (n?: number | null) => (n === null || n === undefined || Number.isNaN(n) ? "—" : num.format(n)),
      pct: (n?: number | null) => (n === null || n === undefined ? "—" : pct.format(n)),
      mins: (n?: number | null) => (n === null || n === undefined ? "—" : `${num.format(Math.round(n))} ${locale === "ar" ? "د" : "min"}`),
      ago: (d?: string | Date | null) => {
        const x = parse(d);
        if (!x) return "—";
        const diff = (x.getTime() - Date.now()) / 60000;
        if (Math.abs(diff) < 60) return rel.format(Math.round(diff), "minute");
        if (Math.abs(diff) < 1440) return rel.format(Math.round(diff / 60), "hour");
        return rel.format(Math.round(diff / 1440), "day");
      },
    };
  }, [locale]);
}
