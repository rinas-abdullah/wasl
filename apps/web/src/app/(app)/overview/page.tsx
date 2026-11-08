"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertOctagon, ArrowUpRight, CalendarClock, ClipboardCheck, Clock, Gauge, PauseCircle, Timer, Truck, Warehouse, Wrench, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, KpiCard, LoadingBlock, PageHeader, StatusBadge, SyntheticBadge, Table, Td, Th } from "@/components/ui";
import { DockCard, EventTimeline, TruckLink, type AnyRec } from "@/components/domain";

export default function OverviewPage() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const q = useQuery({ queryKey: ["dashboard", "overview"], queryFn: () => api.get<AnyRec>("/api/dashboard/overview"), refetchInterval: 60_000 });
  const risk = useQuery({ queryKey: ["dashboard", "risk"], queryFn: () => api.get<AnyRec>("/api/dashboard/congestion-risk"), refetchInterval: 120_000 });

  if (q.isLoading) return <Card><LoadingBlock rows={8} /></Card>;
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const d = q.data!;
  const k = d.kpis;
  const rtl = locale === "ar";

  return (
    <>
      <PageHeader
        title={t("نظرة عامة تشغيلية", "Operational overview")}
        description={t("جميع المؤشرات مشتقة مباشرة من سجلات النظام المخزنة لهذه المنشأة، وتتحدث فور أي تغيير تشغيلي.", "Every indicator is derived directly from this facility's stored records and refreshes on every operational change.")}
        badges={<SyntheticBadge kind="demo" />}
        actions={<span className="text-[12px] text-muted">{t("آخر تحديث", "Updated")} <span className="num">{f.time(d.generatedAt)}</span></span>}
      />

      <section aria-label={t("المؤشرات الرئيسية", "Key indicators")} className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label={t("شاحنات مجدولة اليوم", "Scheduled today")} value={k.totalScheduledToday} icon={<CalendarClock />} tone="info" href="/schedule" />
        <KpiCard label={t("وصول اليوم", "Arrivals today")} value={k.arrivalsToday} icon={<Truck />} tone="teal" href="/trucks?status=ARRIVED" />
        <KpiCard label={t("في الانتظار", "Waiting")} value={k.trucksWaiting} sub={t(`إشغال الساحة ${k.yardOccupancy}/${d.facility.yardCapacity}`, `Yard ${k.yardOccupancy}/${d.facility.yardCapacity}`)} icon={<Clock />} tone={k.trucksWaiting > 0 ? "warn" : "neutral"} href="/live" />
        <KpiCard label={t("قيد الخدمة", "In service")} value={k.trucksInService} icon={<Zap />} tone="ok" href="/live" />
        <KpiCard label={t("أرصفة متاحة", "Available docks")} value={k.availableDocks} sub={t(`${k.occupiedDocks} مشغول`, `${k.occupiedDocks} occupied`)} icon={<Warehouse />} tone="ok" href="/docks" />
        <KpiCard label={t("أرصفة خارج الخدمة", "Docks out of service")} value={k.outOfServiceDocks} icon={<Wrench />} tone={k.outOfServiceDocks ? "bad" : "neutral"} href="/docks" />
        <KpiCard label={t("متوسط الانتظار اليوم", "Avg. waiting today")} value={k.avgWaitingTimeMin === null ? "—" : f.mins(k.avgWaitingTimeMin)} sub={t(`من ${k.avgWaitingSample} شاحنات بدأت خدمتها`, `from ${k.avgWaitingSample} served trucks`)} icon={<Timer />} tone="neutral" />
        <KpiCard label={t("متوسط زمن الدورة", "Avg. turnaround")} value={k.avgTurnaroundTimeMin === null ? "—" : f.mins(k.avgTurnaroundTimeMin)} sub={t(`من ${k.avgTurnaroundSample} شاحنات غادرت`, `from ${k.avgTurnaroundSample} departed`)} icon={<Gauge />} tone="neutral" />
        <KpiCard label={t("مراجعات جودة معلقة", "Pending quality reviews")} value={k.pendingQualityReviews} icon={<ClipboardCheck />} tone={k.pendingQualityReviews ? "warn" : "neutral"} href="/quality" />
        <KpiCard label={t("قرارات تأجيل/إعادة تخصيص", "Readiness holds")} value={k.readinessHolds} icon={<PauseCircle />} tone={k.readinessHolds ? "warn" : "neutral"} href="/decisions" />
        <KpiCard label={t("اضطرابات نشطة", "Active disruptions")} value={k.activeDisruptions} sub={t("أرصفة/فرق/معدات غير متاحة", "Docks/teams/equipment down")} icon={<AlertOctagon />} tone={k.activeDisruptions ? "bad" : "neutral"} href="/resources" />
        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[12px] font-medium text-muted">{t("خطر الاختناق (ساعتان)", "Congestion risk (2h)")}</span>
            <Link href="/models" className="text-muted hover:text-teal-700" aria-label={t("تفاصيل النموذج", "Model details")}><ArrowUpRight className="size-4" /></Link>
          </div>
          {risk.data?.available ? (
            <div className="mt-3">
              <div className={`num text-start text-[26px] font-semibold leading-none ${risk.data.probability >= 0.6 ? "text-bad" : risk.data.probability >= 0.3 ? "text-warn" : "text-ok"}`}>{f.pct(risk.data.probability)}</div>
              <div className="mt-1.5 text-[11px] leading-snug text-muted">{t(`احتمال تجاوز ${risk.data.threshold_queue_length} شاحنات في الطابور`, `P(queue ≥ ${risk.data.threshold_queue_length} trucks)`)} · <span className="text-teal-700">{t("نموذج تجريبي", "experimental model")}</span></div>
            </div>
          ) : (
            <p className="mt-3 text-[11.5px] text-muted">{risk.isLoading ? t("جارٍ الحساب…", "Computing…") : t("خدمة النماذج غير متاحة حاليًا — لا يُعرض تقدير.", "Model service unavailable — no estimate shown.")}</p>
          )}
        </Card>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title={t("حالة الأرصفة والموارد", "Dock & resource status")} subtitle={t("حالة فعّالة محسوبة من الحجوزات والخدمة الجارية", "Effective state computed from reservations and active service")} actions={<Link href="/twin" className="text-[12px] font-medium text-teal-700 hover:underline">{t("فتح التوأم الرقمي", "Open digital twin")}</Link>} />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {d.docks.map((dock: AnyRec) => <Link key={dock.id} href="/docks"><DockCard dock={dock} /></Link>)}
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {d.teams.map((tm: AnyRec) => (
                <div key={tm.id} className="flex items-center justify-between rounded-lg border border-line-2 px-3 py-2">
                  <div>
                    <p className="text-[12.5px] font-medium">{locale === "ar" ? tm.nameAr : tm.name} <span className="text-muted">· {tm.size}</span></p>
                    <p className="num text-[11px] text-muted">{tm.shiftStart}–{tm.shiftEnd}</p>
                  </div>
                  <StatusBadge group="resource" value={tm.status} />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("قائمة القرارات", "Decision queue")} subtitle={t("قرارات تنتظر مراجعة المشرف", "Decisions awaiting supervisor review")} actions={<Badge tone={d.decisionQueue.length ? "warn" : "neutral"}>{d.decisionQueue.length}</Badge>} />
          <div className="scroll-thin max-h-[330px] overflow-y-auto">
            {d.decisionQueue.length === 0 ? (
              <EmptyState title={t("لا توجد قرارات معلقة", "No pending decisions")} />
            ) : (
              <ul className="divide-y divide-line-2">
                {d.decisionQueue.map((x: AnyRec) => (
                  <li key={x.id} className="px-5 py-3">
                    {x.kind === "PLAN" ? (
                      <Link href={`/optimization?run=${x.id}`} className="block">
                        <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">{t("خطة تحسين بانتظار الاعتماد", "Optimization plan awaiting approval")}</span><StatusBadge group="solver" value={x.solverStatus} /></div>
                        <p className="mt-0.5 text-[11.5px] text-muted">{x.title} · {f.ago(x.createdAt)}</p>
                      </Link>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium">{x.truckCode ? <TruckLink id={x.truckId} code={x.truckCode} /> : null} <span className="text-ink-2">· {label("decisionType", x.type, locale)}</span></span>
                          <StatusBadge group="outcome" value={x.outcome} />
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{(x.reasons ?? []).map((r: AnyRec) => (locale === "ar" ? r.ar : r.en)).join(" · ")}</p>
                        <Link href={`/readiness?truck=${x.truckId}`} className="mt-1 inline-block text-[11.5px] font-medium text-teal-700 hover:underline">{t("فحص الجاهزية", "Inspect readiness")} →</Link>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title={t("الشاحنات القادمة", "Upcoming arrivals")} actions={<Link href="/trucks" className="text-[12px] font-medium text-teal-700 hover:underline">{t("كل الشاحنات", "All trucks")}</Link>} />
          {d.upcoming.length === 0 ? <EmptyState title={t("لا توجد شاحنات قادمة", "No upcoming trucks")} /> : (
            <Table>
              <thead><tr><Th>{t("الشاحنة", "Truck")}</Th><Th>{t("الناقل", "Carrier")}</Th><Th>{t("الحمولة", "Cargo")}</Th><Th>{t("الموعد", "Planned")}</Th><Th>{t("الرصيف", "Dock")}</Th><Th>{t("الحالة", "Status")}</Th></tr></thead>
              <tbody>
                {d.upcoming.map((u: AnyRec) => (
                  <tr key={u.id} className="hover:bg-canvas/60">
                    <Td><TruckLink id={u.id} code={u.code} />{u.priority === "HIGH" || u.priority === "CRITICAL" ? <Badge tone="warn" className="ms-1.5">{label("priority", u.priority, locale)}</Badge> : null}</Td>
                    <Td className="text-ink-2">{locale === "ar" ? u.carrierAr : u.carrier}</Td>
                    <Td>{label("cargo", u.cargoType, locale)}{u.qualityStatus !== "NO_ISSUE_OBSERVED" ? <StatusBadge group="quality" value={u.qualityStatus} className="ms-1.5" /> : null}</Td>
                    <Td className="num">{f.time(u.plannedArrival)} {!u.confirmed ? <span className="text-[11px] text-muted">({t("مطلوب", "requested")})</span> : null}</Td>
                    <Td className="num">{u.dockCode ?? "—"}{u.reassignmentRequired ? <Badge tone="bad" className="ms-1.5">{t("إعادة تخصيص", "Reassign")}</Badge> : null}</Td>
                    <Td><StatusBadge group="truckStatus" value={u.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("تنبيهات حرجة", "Critical alerts")} actions={<Link href="/notifications" className="text-[12px] font-medium text-teal-700 hover:underline">{t("الكل", "All")}</Link>} />
          {d.alerts.length === 0 ? <EmptyState title={t("لا توجد تنبيهات حرجة مفتوحة", "No open critical alerts")} /> : (
            <ul className="divide-y divide-line-2">
              {d.alerts.map((a: AnyRec) => (
                <li key={a.id} className="flex gap-3 px-5 py-3">
                  <StatusBadge group="severity" value={a.severity} />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium">{locale === "ar" ? a.titleAr : a.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{locale === "ar" ? a.bodyAr : a.body}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{a.type} · {f.ago(a.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title={t("اتجاهات اليوم بالساعة", "Today by hour")} subtitle={t("المخطط مقابل الوصول الفعلي مقابل اكتمال الخدمة — من السجلات المخزنة", "Planned vs. actual arrivals vs. completed service — from stored records")} />
          <CardBody>
            <div className="h-64" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.hourly.filter((h: AnyRec, i: number) => i >= 5 && i <= 22)} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#637487" }} reversed={rtl} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#637487" }} orientation={rtl ? "right" : "left"} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8ee", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="planned" name={t("مخطط", "Planned")} fill="#c9d6e3" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="arrived" name={t("وصل", "Arrived")} fill="#18bdb5" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" name={t("اكتملت الخدمة", "Completed")} fill="#0b2e52" radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("الخط الزمني للعمليات", "Operations timeline")} actions={<Link href="/events" className="text-[12px] font-medium text-teal-700 hover:underline">{t("السجل الكامل", "Full log")}</Link>} />
          <CardBody className="scroll-thin max-h-72 overflow-y-auto">
            <EventTimeline events={d.timeline} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

