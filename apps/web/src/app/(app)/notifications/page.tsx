"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import type { AnyRec } from "@/components/domain";
import { cn } from "@/lib/utils";

const LINK: Record<string, (id: string) => string> = { truck: (id) => `/trucks/${id}`, dock: () => "/docks", quality_review: (id) => `/quality?review=${id}`, optimization_run: (id) => `/optimization?run=${id}`, simulation_scenario: (id) => `/simulation?scenario=${id}`, team: () => "/resources", equipment: () => "/resources" };

export default function NotificationsPage() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");
  const q = useQuery({ queryKey: ["notifications", "list", tab], queryFn: () => api.get<AnyRec>(`/api/notifications${tab === "unread" ? "?unreadOnly=true" : ""}`) });
  const mark = useMutation({ mutationFn: (ids: string[] | "all") => api.post("/api/notifications/read", { ids }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  return (
    <>
      <PageHeader title={t("التنبيهات", "Notifications")} description={t("تنبيهات داخل التطبيق موجهة حسب الدور والمستخدم والناقل. لا يرسل النظام بريدًا أو SMS أو WhatsApp — لا توجد تكاملات خارجية مفعّلة.", "In-app notifications targeted by role, user and carrier. The system sends no email, SMS or WhatsApp — no external integrations are enabled.")} actions={<><Tabs value={tab} onValueChange={setTab} items={[{ value: "all", label: t("الكل", "All") }, { value: "unread", label: t("غير مقروء", "Unread"), count: q.data?.unread }]} /><Button variant="outline" onClick={() => mark.mutate("all")} loading={mark.isPending}><CheckCheck />{t("تحديد الكل كمقروء", "Mark all read")}</Button></>} />
      <Card>
        {q.isLoading ? <LoadingBlock rows={8} /> : q.error ? <ErrorState error={q.error} /> : !q.data?.items.length ? <EmptyState title={t("لا توجد تنبيهات", "No notifications")} /> : (
          <ul className="divide-y divide-line-2">
            {q.data!.items.map((n: AnyRec) => {
              const href = n.entityType && LINK[n.entityType] ? LINK[n.entityType](n.entityId) : null;
              return (
                <li key={n.id} className={cn("flex gap-4 px-5 py-4", !n.read && "bg-teal-50/40")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-teal-500")} aria-label={n.read ? t("مقروء", "Read") : t("غير مقروء", "Unread")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13.5px] font-medium">{locale === "ar" ? n.titleAr : n.title}</p>
                      <StatusBadge group="severity" value={n.severity} />
                      {n.actionRequired && !n.resolvedAt ? <Badge tone="warn">{t("إجراء مطلوب", "Action required")}</Badge> : null}
                      {n.resolvedAt ? <Badge tone="ok">{t("تمت المعالجة", "Resolved")}</Badge> : null}
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{locale === "ar" ? n.bodyAr : n.body}</p>
                    <p className="mt-1 text-[11.5px] text-muted"><span className="num">{f.dateTime(n.createdAt)}</span> · {n.type}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {href ? <Link href={href} onClick={() => !n.read && mark.mutate([n.id])} className="text-[12px] font-medium text-teal-700 hover:underline">{t("فتح", "Open")}</Link> : null}
                    {!n.read ? <button onClick={() => mark.mutate([n.id])} className="text-[12px] text-muted hover:text-ink">{t("تحديد كمقروء", "Mark read")}</button> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
