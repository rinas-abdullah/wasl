"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Bell, Check, ChevronDown, FlaskConical, Globe, LogIn, LogOut, Menu, RotateCcw, Search, UserCog, X } from "lucide-react";
import { ROLE_PERMISSIONS, type Role } from "@wasl/shared";
import { toast } from "sonner";
import { api, NO_AUTO_DEMO_KEY, type DemoAccount } from "@/lib/api";
import { setLocale, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useLiveUpdates } from "@/lib/live";
import { useCan, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ALL_NAV, NAV } from "./nav";
import { Button, ConfirmDialog } from "./ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const session = useSession();
  const can = useCan();
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { connected } = useLiveUpdates();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => setMobileOpen(false), [path]);

  const unread = useQuery({ queryKey: ["notifications", "unread"], queryFn: () => api.get<{ unread: number }>("/api/notifications?unreadOnly=true"), refetchInterval: 60_000, enabled: can("notifications:read") });
  const facilities = useQuery({ queryKey: ["facilities"], queryFn: () => api.get<{ id: string; code: string; name: string; nameAr: string }[]>("/api/facilities"), staleTime: 300_000 });

  const current = ALL_NAV.find((n) => path === n.href || path.startsWith(n.href + "/"));
  const group = NAV.find((g) => g.items.includes(current!));

  const demoAccounts = useQuery({ queryKey: ["demo-accounts"], queryFn: () => api.get<DemoAccount[]>("/api/auth/demo-accounts"), enabled: session.demoMode, staleTime: 600_000 });
  const [switching, setSwitching] = useState<string | null>(null);
  async function switchRole(a: DemoAccount) {
    if (a.email === session.user.email) return;
    setSwitching(a.email);
    try {
      await api.post("/api/auth/demo-login", { email: a.email });
      qc.clear();
      window.location.href = ROLE_PERMISSIONS[a.role as Role]?.includes("dashboard:read") ? "/overview" : "/trucks";
    } catch (e) {
      toast.error((e as Error).message);
      setSwitching(null);
    }
  }

  async function logout() {
    try {
      sessionStorage.setItem(NO_AUTO_DEMO_KEY, "1");
    } catch {
      /* storage unavailable */
    }
    await api.post("/api/auth/logout").catch(() => undefined);
    qc.clear();
    window.location.href = "/login";
  }
  async function switchFacility(id: string) {
    await api.post("/api/session/facility", { facilityId: id });
    qc.invalidateQueries();
  }
  async function resetDemo() {
    setResetting(true);
    try {
      await api.post("/api/demo/reset");
      qc.invalidateQueries();
      toast.success(t("أعيدت بيانات التجربة إلى حالة البداية", "Demo data restored to its initial scenario"));
      setResetOpen(false);
      router.push("/overview");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setResetting(false);
    }
  }
  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (search.trim()) router.push(`/trucks?q=${encodeURIComponent(search.trim())}`);
  }

  const sidebar = (
    <nav aria-label={t("التنقل الرئيسي", "Main navigation")} className="flex h-full flex-col">
      <div className="px-4 pb-4 pt-5">
        <Link href="/overview" className="block px-2 py-1" aria-label="WASL">
          {/* Approved logo used as-is (only surrounding whitespace trimmed). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wasl-logo-trim.png" alt="وَصل | WASL" className="h-10 w-auto" />
        </Link>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => can(i.perm));
          if (!items.length) return null;
          return (
            <div key={g.en}>
              <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{locale === "ar" ? g.ar : g.en}</p>
              <ul className="space-y-0.5">
                {items.map((i) => {
                  const active = current?.href === i.href;
                  const Icon = i.icon;
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-ink-2 transition-colors hover:bg-canvas hover:text-ink",
                          active && "bg-teal-50 font-semibold text-navy-900 shadow-[inset_3px_0_0_var(--color-teal-500)] rtl:shadow-[inset_-3px_0_0_var(--color-teal-500)]",
                        )}
                      >
                        <Icon className={cn("size-[17px]", active ? "text-teal-600" : "text-muted")} />
                        {locale === "ar" ? i.ar : i.en}
                        {i.href === "/notifications" && (unread.data?.unread ?? 0) > 0 ? <span className="num ms-auto rounded-full bg-teal-500 px-1.5 text-[10.5px] font-semibold text-white">{unread.data!.unread}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-line p-4 text-[11.5px] leading-relaxed text-ink-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", connected ? "bg-teal-500 shadow-[0_0_0_3px_rgb(24_189_181/0.25)]" : "bg-muted")} />
          {connected ? t("متصل بالتحديثات المباشرة", "Live updates connected") : t("إعادة الاتصال…", "Reconnecting…")}
        </div>
        <p className="mt-1.5 text-muted">{t("بيئة نموذج أولي — بيانات اصطناعية، حساسات افتراضية، لا يوجد مستودع حقيقي متصل.", "Prototype environment — synthetic data, virtual sensors, no real warehouse connected.")}</p>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-[248px] shrink-0 border-e border-line bg-surface lg:block">{sidebar}</aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-[260px] bg-surface">
            <button className="absolute end-2 top-2 rounded p-1 text-ink-2" onClick={() => setMobileOpen(false)} aria-label={t("إغلاق القائمة", "Close menu")}><X className="size-5" /></button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:px-6">
          <button className="rounded-md p-1.5 text-ink-2 hover:bg-line-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("فتح القائمة", "Open menu")}><Menu className="size-5" /></button>
          <nav aria-label={t("مسار التنقل", "Breadcrumb")} className="hidden min-w-0 items-center gap-1.5 text-[12.5px] text-muted md:flex">
            <span>{locale === "ar" ? session.facility.nameAr : session.facility.name}</span>
            {group ? <><span aria-hidden>/</span><span>{locale === "ar" ? group.ar : group.en}</span></> : null}
            {current ? <><span aria-hidden>/</span><span className="font-medium text-ink">{locale === "ar" ? current.ar : current.en}</span></> : null}
          </nav>
          <form onSubmit={onSearch} className="relative ms-auto hidden w-64 sm:block" role="search">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("بحث عن شاحنة، لوحة، شحنة…", "Search truck, plate, shipment…")} aria-label={t("بحث", "Search")} className="h-9 w-full rounded-lg border border-line bg-canvas ps-8 pe-3 text-[12.5px] focus:border-teal-500 focus:outline-none" />
          </form>
          {session.demoMode ? (
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <button className="hidden items-center gap-1.5 rounded-lg border border-dashed border-teal-500/70 bg-teal-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-teal-700 md:inline-flex">
                  <FlaskConical className="size-3.5" />
                  {t("وضع التجربة", "Demo mode")}
                </button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content align="end" sideOffset={6} className="z-50 w-72 rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-ink-2 shadow-xl">
                  {t("جميع البيانات اصطناعية لأغراض التجربة. الحساسات افتراضية بالكامل. يمكن إعادة الضبط إلى حالة البداية دون المساس بأي بيانات إنتاجية.", "All data is synthetic for demonstration. Sensors are fully virtual. Reset restores the initial scenario without touching any production data.")}
                  {can("demo:reset") ? (
                    <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setResetOpen(true)}><RotateCcw />{t("إعادة ضبط التجربة", "Reset demo scenario")}</Button>
                  ) : null}
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          ) : null}
          {(facilities.data?.length ?? 0) > 1 ? (
            <select aria-label={t("المنشأة", "Facility")} value={session.facility.id} onChange={(e) => switchFacility(e.target.value)} className="hidden h-9 rounded-lg border border-line bg-surface px-2 text-[12.5px] md:block">
              {facilities.data!.map((f) => <option key={f.id} value={f.id}>{locale === "ar" ? f.nameAr : f.name}</option>)}
            </select>
          ) : null}
          {session.demoMode && (demoAccounts.data?.length ?? 0) > 0 ? (
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink-2 hover:border-teal-500" aria-label={t("تبديل الدور", "Switch role")}>
                  <UserCog className="size-4 text-teal-600" />
                  <span className="hidden sm:inline">{t("تبديل الدور", "Switch role")}</span>
                  <ChevronDown className="size-3.5 text-muted" />
                </button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content align="end" sideOffset={6} className="z-50 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
                  <p className="px-2.5 py-1.5 text-[11px] text-muted">{t("جرّب المنصة بأي دور — بيانات اصطناعية", "Try the platform as any role — synthetic data")}</p>
                  {demoAccounts.data!.map((a) => (
                    <Dropdown.Item key={a.email} onSelect={(e) => { e.preventDefault(); void switchRole(a); }} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink outline-none data-[highlighted]:bg-canvas">
                      <span>{label("role", a.role, locale)}</span>
                      {a.email === session.user.email ? <Check className="size-4 text-teal-600" /> : switching === a.email ? <span className="size-3.5 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" /> : null}
                    </Dropdown.Item>
                  ))}
                  <Dropdown.Separator className="my-1 h-px bg-line-2" />
                  <Dropdown.Item onSelect={() => (window.location.href = "/login")} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-2 outline-none data-[highlighted]:bg-canvas">
                    <LogIn className="size-4" />
                    {t("تسجيل الدخول بالبريد الإلكتروني", "Sign in with email")}
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          ) : null}
          <button onClick={() => setLocale(locale === "ar" ? "en" : "ar")} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-line-2" aria-label={t("تغيير اللغة", "Change language")}>
            <Globe className="size-4" />
            {locale === "ar" ? "English" : "العربية"}
          </button>
          {can("notifications:read") ? (
            <Link href="/notifications" className="relative rounded-lg p-2 text-ink-2 hover:bg-line-2" aria-label={t("التنبيهات", "Notifications")}>
              <Bell className="size-[18px]" />
              {(unread.data?.unread ?? 0) > 0 ? <span className="num absolute -top-0.5 end-0 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread.data!.unread > 99 ? "99+" : unread.data!.unread}</span> : null}
            </Link>
          ) : null}
          <Dropdown.Root>
            <Dropdown.Trigger asChild>
              <button className="flex items-center gap-2 rounded-lg py-1 ps-1 pe-2 hover:bg-line-2" aria-label={t("قائمة الحساب", "Account menu")}>
                <span className="grid size-8 place-items-center rounded-lg bg-teal-50 text-[12px] font-semibold text-teal-700">{session.user.name.slice(0, 2).toUpperCase()}</span>
                <span className="hidden text-start leading-tight xl:block">
                  <span className="block text-[12.5px] font-medium text-ink">{session.user.name}</span>
                  <span className="block text-[11px] text-muted">{label("role", session.role, locale)}</span>
                </span>
                <ChevronDown className="size-3.5 text-muted" />
              </button>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content align="end" sideOffset={6} className="z-50 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
                <div className="px-2.5 py-2 text-xs">
                  <p className="font-medium text-ink">{session.user.name}</p>
                  <p className="text-muted">{session.user.email}</p>
                  <p className="mt-1 text-muted">{label("role", session.role, locale)} · {locale === "ar" ? session.organization.nameAr : session.organization.name}</p>
                </div>
                <Dropdown.Separator className="my-1 h-px bg-line-2" />
                <Dropdown.Item onSelect={() => (window.location.href = "/login")} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-2 outline-none data-[highlighted]:bg-canvas">
                  <LogIn className="size-4" />
                  {t("الدخول بحساب آخر", "Sign in with another account")}
                </Dropdown.Item>
                <Dropdown.Item onSelect={logout} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-bad outline-none data-[highlighted]:bg-bad-bg">
                  <LogOut className="size-4" />
                  {t("تسجيل الخروج", "Sign out")}
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 lg:px-7">{children}</main>
      </div>
      <ConfirmDialog open={resetOpen} onOpenChange={setResetOpen} title={t("إعادة ضبط سيناريو التجربة؟", "Reset the demo scenario?")} description={t("سيتم حذف جميع العمليات المسجلة في منشأة التجربة وإعادة إنشاء البيانات الأولية المرتبطة بالوقت الحالي. لا يؤثر ذلك على الحسابات أو أي منشأة غير تجريبية.", "All operations recorded in the demo facility will be deleted and the initial data recreated relative to the current time. Accounts and non-demo organisations are not affected.")} confirmLabel={t("إعادة الضبط", "Reset")} tone="danger" loading={resetting} onConfirm={resetDemo} />
    </div>
  );
}
