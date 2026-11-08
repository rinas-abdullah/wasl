"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReadinessCheck } from "@wasl/shared";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, KeyValue, LoadingBlock, PageHeader, Select, StatusBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { OutcomeBanner, ReadinessChecklist, TruckLink, type AnyRec } from "@/components/domain";

function localInputValue(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function ReadinessInner() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [truckId, setTruckId] = useState(sp.get("truck") ?? "");
  const [callTime, setCallTime] = useState(localInputValue(new Date()));
  const [result, setResult] = useState<AnyRec | null>(null);
  const [override, setOverride] = useState<string[]>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const candidates = useQuery({ queryKey: ["trucks", "releasable"], queryFn: () => api.get<{ items: AnyRec[] }>("/api/trucks?status=SCHEDULED&status=WAITING&status=CALLED&status=REGISTERED&pageSize=100&sort=plannedArrival") });
  const history = useQuery({ queryKey: ["readiness", "history", truckId], queryFn: () => api.get<AnyRec[]>(`/api/readiness/evaluations${truckId ? `?truckId=${truckId}` : ""}`) });

  const evaluate = useMutation({
    mutationFn: () => api.post<AnyRec>("/api/readiness/evaluate", { truckId, proposedCallTime: new Date(callTime).toISOString() }),
    onSuccess: (r) => {
      setResult(r);
      setOverride([]);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const release = useMutation({
    mutationFn: (withOverride: boolean) =>
      api.post<AnyRec>("/api/readiness/release", { truckId, proposedCallTime: new Date(callTime).toISOString(), override: withOverride ? { checkIds: override, reason: overrideReason } : undefined }, { idempotencyKey: newIdempotencyKey(), allowStatus: [409] }),
    onSuccess: (r) => {
      if (r.released) {
        toast.success(t(`تم الاستدعاء — نافذة الرصيف ${f.time(r.windowStart)}–${f.time(r.windowEnd)}`, `Released — dock window ${f.time(r.windowStart)}–${f.time(r.windowEnd)}`), { description: r.overridden?.length ? t(`تجاوز موثق: ${r.overridden.join(", ")}`, `Documented override: ${r.overridden.join(", ")}`) : undefined });
        setOverrideOpen(false);
        qc.invalidateQueries();
        evaluate.reset();
        setResult(null);
      } else if (r.error) {
        toast.error(r.error.message);
      } else {
        toast.warning(t("لم يتم الاستدعاء — أعاد الخادم التقييم ولم تتحقق الشروط الإلزامية.", "Not released — the server re-evaluated and mandatory conditions are not met."));
        setResult({ ...r, checks: r.checks });
      }
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "NON_OVERRIDABLE_CHECKS") toast.error(t("بعض الشروط قيود سلامة/سعة غير قابلة للتجاوز", "Some checks are safety/capacity constraints that cannot be overridden"));
      else toast.error((e as Error).message);
    },
  });

  useEffect(() => {
    if (truckId) {
      router.replace(`/readiness?truck=${truckId}`);
      evaluate.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId]);

  const truck = candidates.data?.items.find((x) => x.id === truckId);
  const checks: ReadinessCheck[] = result?.checks ?? [];
  const failingBlocking = checks.filter((c) => c.result === "FAIL" && c.blocking);
  const allOverridable = failingBlocking.length > 0 && failingBlocking.every((c) => override.includes(c.checkId));

  return (
    <>
      <PageHeader
        title={t("محرك الجاهزية للاستدعاء", "Readiness-to-Release engine")}
        description={t("لا يصدر الاستدعاء بناءً على الموعد وحده. يقيّم الخادم 13 شرطًا تشغيليًا (الرصيف، التوافق، العمالة، المعدات، البوابة، الساحة، المستندات، الجودة…) ثم يحجز الموارد ذريًا داخل معاملة واحدة تمنع حجز المورد نفسه مرتين.", "A call is never issued on the appointment alone. The server evaluates 13 operational conditions (dock, compatibility, crew, equipment, gate, yard, documents, quality…) and then reserves resources atomically in one transaction that prevents double-booking.")}
      />
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("المدخلات", "Inputs")} />
            <CardBody className="space-y-4">
              <Field label={t("الشاحنة", "Truck")} htmlFor="r-truck">
                <Select id="r-truck" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
                  <option value="">{t("اختر شاحنة…", "Select a truck…")}</option>
                  {candidates.data?.items.map((x) => <option key={x.id} value={x.id}>{x.code} · {label("truckStatus", x.status, locale)} · {x.dock?.code ?? "—"}</option>)}
                </Select>
              </Field>
              <Field label={t("وقت الاستدعاء المقترح", "Proposed call time")} htmlFor="r-time" hint={t("يُضاف زمن الطريق (أو 5 دقائق من الساحة) لحساب نافذة الرصيف", "Travel time (or 5 min from the yard) is added to compute the dock window")}>
                <Input id="r-time" type="datetime-local" dir="ltr" value={callTime} onChange={(e) => setCallTime(e.target.value)} />
              </Field>
              <Button className="w-full" variant="outline" disabled={!truckId} loading={evaluate.isPending} onClick={() => evaluate.mutate()}><RefreshCw />{t("تقييم الجاهزية", "Evaluate readiness")}</Button>
            </CardBody>
          </Card>
          {truck ? (
            <Card>
              <CardHeader title={<TruckLink id={truck.id} code={truck.code} />} subtitle={locale === "ar" ? truck.carrier.nameAr : truck.carrier.name} />
              <CardBody>
                <KeyValue items={[
                  { k: t("الحالة", "Status"), v: <StatusBadge group="truckStatus" value={truck.status} /> },
                  { k: t("الرصيف", "Dock"), v: truck.dock?.code ?? "—" },
                  { k: t("الحمولة", "Cargo"), v: label("cargo", truck.shipment.cargoType, locale) },
                  { k: t("الجودة", "Quality"), v: <StatusBadge group="quality" value={truck.shipment.qualityStatus} /> },
                  { k: t("الموعد المؤكد", "Confirmed"), v: <span className="num">{f.time(truck.appointment?.confirmedStart)}</span> },
                  { k: t("مدة الخدمة", "Service"), v: <span className="num">{truck.serviceEstimateMin} {t("د", "min")}</span> },
                ]} />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title={t("نتيجة التقييم", "Evaluation result")}
              subtitle={result ? <span className="num">{result.engineVersion} · {f.dateTime(result.evaluatedAt)} · {t("وصول الرصيف المتوقع", "Expected at dock")} {f.time(result.expectedDockArrival)}</span> : undefined}
              actions={
                result ? (
                  <>
                    {result.outcome !== "READY" && can("release:override") && failingBlocking.some((c) => c.overridable) ? (
                      <Button variant="outline" disabledReason={allOverridable ? null : t("حدد كل الشروط الفاشلة القابلة للتجاوز أولًا (يجب ألا يوجد شرط غير قابل للتجاوز)", "Select every failing overridable check first (no non-overridable check may fail)")} onClick={() => setOverrideOpen(true)}><ShieldAlert />{t("تجاوز إداري", "Override")}</Button>
                    ) : null}
                    {can("release:execute") ? (
                      <Button variant="teal" loading={release.isPending && !overrideOpen} disabledReason={result.outcome === "READY" ? null : t("الشروط الإلزامية غير متحققة", "Mandatory conditions are not met")} onClick={() => release.mutate(false)}><Megaphone />{t("إصدار الاستدعاء", "Release truck")}</Button>
                    ) : null}
                  </>
                ) : null
              }
            />
            <CardBody>
              {evaluate.isPending ? <LoadingBlock rows={6} /> : evaluate.error ? <ErrorState error={evaluate.error} /> : !result ? (
                <EmptyState icon={<ShieldCheck className="size-5" />} title={t("اختر شاحنة لتقييم جاهزيتها", "Select a truck to evaluate")} description={t("كل تقييم يُحفظ مع لقطة المدخلات والأدلة ويظهر في مركز القرارات.", "Every evaluation is stored with its input snapshot and evidence and appears in the Decision Center.")} />
              ) : (
                <div className="space-y-4">
                  <OutcomeBanner outcome={result.outcome} summary={result.summary} summaryAr={result.summaryAr} />
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg bg-canvas px-3 py-2.5 text-[12px]"><p className="text-muted">{t("شروط ناجحة", "Passed")}</p><p className="num text-lg font-semibold text-ok">{checks.filter((c) => c.result === "PASS").length}</p></div>
                    <div className="rounded-lg bg-canvas px-3 py-2.5 text-[12px]"><p className="text-muted">{t("تحذيرات", "Warnings")}</p><p className="num text-lg font-semibold text-warn">{checks.filter((c) => c.result === "WARN").length}</p></div>
                    <div className="rounded-lg bg-canvas px-3 py-2.5 text-[12px]"><p className="text-muted">{t("موانع إلزامية", "Blocking failures")}</p><p className="num text-lg font-semibold text-bad">{failingBlocking.length}</p></div>
                  </div>
                  {result.nextReevaluationAt ? <p className="rounded-lg bg-warn-bg px-3 py-2 text-[12.5px] text-warn">{t("وقت إعادة التقييم المتوقع", "Expected re-evaluation time")}: <span className="num font-semibold">{f.time(result.nextReevaluationAt)}</span> — {t("محسوب من أقرب وقت تزول فيه جميع الموانع", "computed from when all blocking conditions are expected to clear")}</p> : null}
                  <ReadinessChecklist checks={checks} selectable={can("release:override")} selected={override} onToggle={(id) => setOverride((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))} />
                  {result.alternatives?.length ? (
                    <div>
                      <p className="mb-2 text-[12px] font-semibold text-navy-800">{t("بدائل الأرصفة المتوافقة (أبكر بدء ممكن)", "Compatible dock alternatives (earliest feasible start)")}</p>
                      <div className="flex flex-wrap gap-2">{result.alternatives.map((a: AnyRec) => <Badge key={a.dockId} tone="info"><span className="num">{a.dockCode} · {f.time(a.earliestStart)}</span></Badge>)}</div>
                      <p className="mt-1.5 text-[11.5px] text-muted">{t("لإعادة التخصيص: صفحة المواعيد أو مركز التحسين (لا يغيّر المحرك التخصيص تلقائيًا).", "To reassign: use Appointments or the Optimization Center (the engine never reassigns silently).")} <Link className="text-teal-700 hover:underline" href={`/schedule?truck=${truckId}`}>{t("فتح المواعيد", "Open appointments")}</Link></p>
                    </div>
                  ) : null}
                  {result.affectedResources?.length ? <p className="text-[12px] text-muted">{t("الموارد المؤثرة", "Affected resources")}: <span className="num">{result.affectedResources.map((r: AnyRec) => `${r.type}:${r.code}`).join(" · ")}</span></p> : null}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("سجل التقييمات", "Evaluation history")} subtitle={t("سجلات محفوظة غير قابلة للتعديل", "Stored, immutable records")} />
            {history.data?.length ? (
              <Table>
                <thead><tr><Th>{t("الوقت", "Time")}</Th><Th>{t("الشاحنة", "Truck")}</Th><Th>{t("النتيجة", "Outcome")}</Th><Th>{t("وقت الاستدعاء", "Call time")}</Th><Th>{t("الإصدار", "Engine")}</Th></tr></thead>
                <tbody>{history.data.slice(0, 15).map((h) => <tr key={h.id}><Td className="num">{f.dateTime(h.evaluatedAt)}</Td><Td><TruckLink id={h.truckId} code={h.truckCode} /></Td><Td><StatusBadge group="outcome" value={h.outcome} /></Td><Td className="num">{f.time(h.proposedCallTime)}</Td><Td className="num text-muted">{h.engineVersion}</Td></tr>)}</tbody>
              </Table>
            ) : <EmptyState title={t("لا يوجد سجل بعد", "No history yet")} />}
          </Card>
        </div>
      </div>

      <Dialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        title={t("تجاوز إداري موثق", "Documented administrative override")}
        description={t("يُسمح بالتجاوز فقط للقواعد المصنفة قابلة للتجاوز في السياسة (المستندات، تأكيد الموعد، سعة البوابة). قيود السلامة والسعة الفعلية لا تُتجاوز أبدًا. يُسجل السبب والمستخدم في سجل التدقيق.", "Only rules marked overridable by policy (documents, appointment confirmation, gate capacity) can be overridden. Safety and physical capacity constraints never can. Reason and user are written to the audit log.")}
        footer={<><Button variant="outline" onClick={() => setOverrideOpen(false)}>{t("إلغاء", "Cancel")}</Button><Button variant="danger" disabled={overrideReason.trim().length < 10} loading={release.isPending} onClick={() => release.mutate(true)}>{t("استدعاء مع التجاوز", "Release with override")}</Button></>}
      >
        <p className="mb-3 text-[12.5px]">{t("الشروط المتجاوزة", "Overridden checks")}: <span className="num font-medium">{override.join(", ")}</span></p>
        <Field label={t("سبب التجاوز (10 أحرف على الأقل)", "Override reason (min. 10 characters)")} htmlFor="ov-reason"><Textarea id="ov-reason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}

export default function ReadinessPage() {
  return (
    <Suspense>
      <ReadinessInner />
    </Suspense>
  );
}
