"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Printer } from "lucide-react";
import { CARGO_TYPES } from "@wasl/shared";
import { api, qs } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, KpiCard, LoadingBlock, PageHeader, Select, StatusBadge, SyntheticBadge, Table, Td, Th } from "@/components/ui";
import { TruckLink, type AnyRec } from "@/components/domain";

const RANGES = { today: 0, "24h": 24, "7d": 168, "30d": 720 } as const;

export default function AnalyticsPage() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const [range, setRange] = useState<keyof typeof RANGES>("today");
  const [flt, setFlt] = useState({ dockId: "", carrierId: "", cargoType: "" });
  const period = useMemo(() => {
    const to = new Date();
    if (range === "today") {
      const local = new Date(to.getTime() + 180 * 60_000);
      local.setUTCHours(0, 0, 0, 0);
      return { from: new Date(local.getTime() - 180 * 60_000).toISOString(), to: to.toISOString() };
    }
    return { from: new Date(to.getTime() - RANGES[range] * 3600_000).toISOString(), to: to.toISOString() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);
  const params = { ...period, ...flt };
  const q = useQuery({ queryKey: ["reports", "operations", params], queryFn: () => api.get<AnyRec>(`/api/reports/operations${qs(params)}`), placeholderData: keepPreviousData });
  const docks = useQuery({ queryKey: ["docks"], queryFn: () => api.get<AnyRec[]>("/api/docks") });
  const carriers = useQuery({ queryKey: ["carriers"], queryFn: () => api.get<AnyRec[]>("/api/carriers") });
  const runs = useQuery({ queryKey: ["optimization", "runs"], queryFn: () => api.get<AnyRec[]>("/api/optimization/runs") });
  const sims = useQuery({ queryKey: ["simulation", "list"], queryFn: () => api.get<AnyRec[]>("/api/simulations/scenarios") });
  const r = q.data;
  const s = r?.summary;

  return (
    <div className="print-area">
      <PageHeader
        title={t("التحليلات والتقارير", "Analytics & reports")}
        description={t("كل رقم في هذه الصفحة محسوب على الخادم من سجلات الشاحنات والحجوزات والأحداث المخزنة للفترة والمرشحات المختارة.", "Every number on this page is computed server-side from stored truck, reservation and event records for the selected period and filters.")}
        badges={<SyntheticBadge kind="demo" />}
        actions={<div className="no-print flex gap-2"><Button variant="outline" onClick={() => (window.location.href = `/api/reports/operations${qs({ ...params, format: "csv" })}`)}><Download />CSV</Button><Button variant="outline" onClick={() => { const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "wasl-operations-report.json"; a.click(); }}><Download />JSON</Button><Button variant="outline" onClick={() => window.print()}><Printer />PDF</Button></div>}
      />
      <Card className="no-print mb-4 flex flex-wrap items-center gap-2 p-3">
        <Select className="w-auto" value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)} aria-label={t("الفترة", "Period")}><option value="today">{t("اليوم", "Today")}</option><option value="24h">{t("آخر 24 ساعة", "Last 24 h")}</option><option value="7d">{t("آخر 7 أيام", "Last 7 days")}</option><option value="30d">{t("آخر 30 يومًا", "Last 30 days")}</option></Select>
        <Select className="w-auto" value={flt.dockId} onChange={(e) => setFlt({ ...flt, dockId: e.target.value })} aria-label={t("الرصيف", "Dock")}><option value="">{t("كل الأرصفة", "All docks")}</option>{docks.data?.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</Select>
        <Select className="w-auto" value={flt.carrierId} onChange={(e) => setFlt({ ...flt, carrierId: e.target.value })} aria-label={t("الناقل", "Carrier")}><option value="">{t("كل الناقلين", "All carriers")}</option>{carriers.data?.map((c) => <option key={c.id} value={c.id}>{locale === "ar" ? c.nameAr : c.name}</option>)}</Select>
        <Select className="w-auto" value={flt.cargoType} onChange={(e) => setFlt({ ...flt, cargoType: e.target.value })} aria-label={t("الحمولة", "Cargo")}><option value="">{t("كل الحمولات", "All cargo")}</option>{CARGO_TYPES.map((c) => <option key={c} value={c}>{label("cargo", c, locale)}</option>)}</Select>
        {r ? <span className="ms-auto text-[12px] text-muted">{f.dateTime(r.period.from)} → {f.dateTime(r.period.to)}</span> : null}
      </Card>
      {q.isLoading ? <Card><LoadingBlock rows={8} /></Card> : q.error ? <Card><ErrorState error={q.error} /></Card> : r ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard label={t("الإنتاجية (شاحنات غادرت)", "Throughput (departed)")} value={s.throughput} sub={t(`${s.served} بدأت خدمتها`, `${s.served} served`)} />
            <KpiCard label={t("متوسط الانتظار", "Avg waiting")} value={f.mins(s.avgWaitingMin)} sub={t("من الوصول إلى بدء الخدمة", "arrival → service start")} />
            <KpiCard label={t("الانتظار P95", "P95 waiting")} value={f.mins(s.p95WaitingMin)} />
            <KpiCard label={t("متوسط زمن الدورة", "Avg turnaround")} value={f.mins(s.avgTurnaroundMin)} sub={t("من الوصول إلى المغادرة", "arrival → departure")} />
            <KpiCard label={t("استغلال الأرصفة", "Dock utilisation")} value={f.pct(s.dockUtilization)} />
            <KpiCard label={t("استغلال الفرق", "Resource utilisation")} value={f.pct(s.resourceUtilization)} />
            <KpiCard label={t("معدل مراجعة الجودة", "Quality review rate")} value={f.pct(s.qualityReviewRate)} />
            <KpiCard label={t("استقرار الجدول", "Schedule stability")} value={f.pct(s.scheduleStability)} sub={t(`${s.reschedules} إعادة جدولة`, `${s.reschedules} reschedules`)} />
            <KpiCard label={t("تقييمات غير جاهزة", "Readiness holds")} value={s.readinessHolds} sub={t(`${s.releases} استدعاء · ${s.overrides} تجاوز`, `${s.releases} releases · ${s.overrides} overrides`)} />
            <KpiCard label={t("تعطلات الأرصفة", "Dock failures")} value={s.dockFailures} sub={t(`${s.plansApproved} خطط معتمدة`, `${s.plansApproved} plans approved`)} />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title={t("أداء الأرصفة", "Dock performance")} />
              <CardBody>
                <div className="h-56" dir="ltr">
                  <ResponsiveContainer><BarChart data={r.docks.map((d: AnyRec) => ({ dock: d.code, util: Math.round(d.utilization * 100), served: d.trucksServed }))} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}><CartesianGrid stroke="#eef2f6" vertical={false} /><XAxis dataKey="dock" tick={{ fontSize: 11 }} reversed={locale === "ar"} /><YAxis unit="%" tick={{ fontSize: 11 }} orientation={locale === "ar" ? "right" : "left"} /><Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} /><Bar dataKey="util" name={t("الاستغلال", "Utilisation")} fill="#0b2e52" radius={[6, 6, 0, 0]} maxBarSize={48} /></BarChart></ResponsiveContainer>
                </div>
                <Table className="mt-3"><thead><tr><Th>{t("الرصيف", "Dock")}</Th><Th>{t("خُدمت", "Served")}</Th><Th>{t("دقائق مشغولة", "Busy min")}</Th><Th>{t("متوسط الخدمة", "Avg service")}</Th><Th>{t("الاستغلال", "Utilisation")}</Th></tr></thead><tbody>{r.docks.map((d: AnyRec) => <tr key={d.dockId}><Td className="num font-medium">{d.code}</Td><Td className="num">{d.trucksServed}</Td><Td className="num">{d.busyMin}</Td><Td className="num">{f.mins(d.avgServiceMin)}</Td><Td className="num">{f.pct(d.utilization)}</Td></tr>)}</tbody></Table>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("تكرار الاختناقات (أسباب عدم الجاهزية)", "Bottleneck frequency (readiness failures)")} />
              <CardBody>
                {r.bottlenecks.length ? (
                  <div className="h-56" dir="ltr"><ResponsiveContainer><BarChart layout="vertical" data={r.bottlenecks.map((b: AnyRec) => ({ name: label("check", b.checkId, locale), count: b.count }))} margin={{ top: 5, right: 20, left: 40, bottom: 0 }}><CartesianGrid stroke="#eef2f6" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} /><Bar dataKey="count" fill="#c08a2c" radius={[0, 6, 6, 0]} maxBarSize={22} /></BarChart></ResponsiveContainer></div>
                ) : <EmptyState title={t("لا توجد تقييمات غير جاهزة في الفترة", "No readiness failures in the period")} />}
                <Table className="mt-3"><thead><tr><Th>{t("الفريق", "Team")}</Th><Th>{t("دقائق مشغولة", "Busy min")}</Th><Th>{t("الاستغلال", "Utilisation")}</Th></tr></thead><tbody>{r.teams.map((x: AnyRec) => <tr key={x.teamId}><Td className="num">{x.code}</Td><Td className="num">{x.busyMin}</Td><Td className="num">{f.pct(x.utilization)}</Td></tr>)}</tbody></Table>
              </CardBody>
            </Card>
          </div>
          <Card className="mt-4">
            <CardHeader title={t("تقرير زمن دورة الشاحنات", "Truck turnaround report")} subtitle={t(`${r.trucks.length} شاحنة في الفترة`, `${r.trucks.length} trucks in period`)} />
            <Table>
              <thead><tr><Th>{t("الشاحنة", "Truck")}</Th><Th>{t("الناقل", "Carrier")}</Th><Th>{t("الحمولة", "Cargo")}</Th><Th>{t("الرصيف", "Dock")}</Th><Th>{t("الوصول", "Arrival")}</Th><Th>{t("الانتظار", "Wait")}</Th><Th>{t("الخدمة المقدرة/الفعلية", "Service est./actual")}</Th><Th>{t("الدورة", "Turnaround")}</Th><Th>{t("الحالة", "Status")}</Th></tr></thead>
              <tbody>{r.trucks.map((x: AnyRec) => <tr key={x.id}><Td><TruckLink id={x.id} code={x.code} /></Td><Td className="text-ink-2">{locale === "ar" ? x.carrierAr : x.carrier}</Td><Td>{label("cargo", x.cargoType, locale)}</Td><Td className="num">{x.dock ?? "—"}</Td><Td className="num">{f.time(x.actualArrival)}</Td><Td className="num">{x.waitingMin ?? "—"}</Td><Td className="num">{x.serviceEstimateMin} / {x.actualServiceMin ?? "—"}</Td><Td className="num">{x.turnaroundMin ?? "—"}</Td><Td><StatusBadge group="truckStatus" value={x.status} /></Td></tr>)}</tbody>
            </Table>
          </Card>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title={t("قرارات التحسين", "Optimisation decisions")} />
              <Table><thead><tr><Th>{t("الوقت", "Time")}</Th><Th>{t("المُحفز", "Trigger")}</Th><Th>{t("المحلل", "Solver")}</Th><Th>{t("الهدف", "Objective")}</Th><Th>{t("الاعتماد", "Approval")}</Th></tr></thead><tbody>{(runs.data ?? []).slice(0, 10).map((x) => <tr key={x.id}><Td className="num"><Link className="hover:underline" href={`/optimization?run=${x.id}`}>{f.dateTime(x.createdAt)}</Link></Td><Td>{x.trigger}</Td><Td>{x.solverStatus ? <StatusBadge group="solver" value={x.solverStatus} /> : "—"}</Td><Td className="num">{f.num(x.objectiveValue)}</Td><Td><StatusBadge group="approval" value={x.approvalStatus} /></Td></tr>)}</tbody></Table>
            </Card>
            <Card>
              <CardHeader title={t("مقارنات المحاكاة", "Simulation comparisons")} actions={<SyntheticBadge kind="simulation" />} />
              <Table><thead><tr><Th>{t("التجربة", "Experiment")}</Th><Th>Seed</Th><Th>{t("التشغيلات", "Runs")}</Th></tr></thead><tbody>{(sims.data ?? []).slice(0, 10).map((x) => <tr key={x.id}><Td><Link className="text-teal-700 hover:underline" href={`/simulation?scenario=${x.id}`}>{x.name}</Link></Td><Td className="num">{x.seed}</Td><Td className="num">{x.completedRuns}/{x.totalRuns}</Td></tr>)}</tbody></Table>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
