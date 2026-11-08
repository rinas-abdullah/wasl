"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, GitBranch, Play, XCircle } from "lucide-react";
import { api, newIdempotencyKey } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, KeyValue, LoadingBlock, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { TruckLink, type AnyRec } from "@/components/domain";
import { cn } from "@/lib/utils";

const WEIGHT_META: { key: string; ar: string; en: string; unit: [string, string] }[] = [
  { key: "waitingPerMin", ar: "الانتظار في الساحة", en: "Yard waiting", unit: ["لكل دقيقة", "per minute"] },
  { key: "tardinessPerMin", ar: "التأخر عن الموعد (بعد مهلة 15 د)", en: "Tardiness vs. slot (after 15-min grace)", unit: ["لكل دقيقة", "per minute"] },
  { key: "disruptionPerMin", ar: "تغيير موعد مؤكد", en: "Moving a confirmed slot", unit: ["لكل دقيقة إزاحة", "per minute shifted"] },
  { key: "reassignment", ar: "إعادة تخصيص اختيارية للرصيف", en: "Voluntary dock reassignment", unit: ["لكل شاحنة", "per truck"] },
  { key: "makespanPerMin", ar: "نهاية آخر خدمة (بديل لزمن تعطل الموارد)", en: "End of last service (idle-time proxy)", unit: ["لكل دقيقة", "per minute"] },
  { key: "unassigned", ar: "شاحنة بلا تخصيص", en: "Unassigned truck", unit: ["لكل شاحنة", "per truck"] },
];

function OptimizationInner() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(sp.get("run"));
  const [runOpen, setRunOpen] = useState(false);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [inspect, setInspect] = useState<AnyRec | null>(null);
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<AnyRec>("/api/settings") });
  const [params, setParams] = useState<AnyRec>({ horizonMin: 600, timeLimitSec: 10, allowUnassigned: true, weights: null });
  useEffect(() => {
    if (settings.data && !params.weights) setParams((p) => ({ ...p, weights: settings.data!.defaultWeights }));
  }, [settings.data, params.weights]);

  const runs = useQuery({ queryKey: ["optimization", "runs"], queryFn: () => api.get<AnyRec[]>("/api/optimization/runs"), refetchInterval: (q) => (q.state.data?.some((r) => r.jobStatus === "QUEUED" || r.jobStatus === "RUNNING") ? 1500 : false) });
  const effectiveRun = runId ?? runs.data?.[0]?.id ?? null;
  const run = useQuery({ queryKey: ["optimization", "run", effectiveRun], queryFn: () => api.get<AnyRec>(`/api/optimization/runs/${effectiveRun}`), enabled: !!effectiveRun, refetchInterval: (q) => (q.state.data && ["QUEUED", "RUNNING"].includes(q.state.data.jobStatus) ? 1500 : false) });

  const start = useMutation({
    mutationFn: () => api.post<AnyRec>("/api/optimization/runs", { ...params, label: t("تشغيل يدوي", "Manual run") }, { idempotencyKey: newIdempotencyKey() }),
    onSuccess: (r) => {
      setRunId(r.id);
      router.replace(`/optimization?run=${r.id}`);
      setRunOpen(false);
      qc.invalidateQueries({ queryKey: ["optimization"] });
      toast.info(t("أُضيف التشغيل إلى طابور المهام — معاينة فقط، لا يُنفذ شيء قبل الاعتماد.", "Run queued — preview only; nothing is applied before approval."));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const decide = useMutation({
    mutationFn: ({ kind, reason }: { kind: "approve" | "reject"; reason: string }) => api.post<AnyRec>(`/api/optimization/runs/${effectiveRun}/${kind}`, { reason: reason || undefined }, { idempotencyKey: newIdempotencyKey() }),
    onSuccess: (r, v) => {
      toast.success(v.kind === "approve" ? t(`اعتُمدت الخطة وطُبّقت على ${r.applied} موعدًا ضمن معاملة واحدة`, `Plan approved and applied to ${r.applied} appointments in one transaction`) : t("رُفضت الخطة", "Plan rejected"));
      setDecision(null);
      qc.invalidateQueries();
    },
    onError: (e) => {
      toast.error((e as Error).message);
      setDecision(null);
      qc.invalidateQueries({ queryKey: ["optimization"] });
    },
  });

  const r = run.data;
  const cands: AnyRec[] = r?.candidates ?? [];
  const bd = r?.objectiveBreakdown ?? {};
  const cur = r?.currentPlanBreakdown ?? {};

  return (
    <>
      <PageHeader
        title={t("مركز التحسين", "Optimization center")}
        description={t("تحسين رياضي فعلي بمحلل Google OR-Tools CP-SAT: متغيرات قرار لتخصيص الرصيف والفريق ووقت البدء، وقيود التوافق وعدم التداخل والورديات والمعدات والمفتشين وسعة الساحة. المسار: معاينة ← اعتماد ← تنفيذ.", "Real mathematical optimisation with Google OR-Tools CP-SAT: decision variables for dock, team and start time; constraints for compatibility, no-overlap, shifts, equipment, inspectors and yard capacity. Flow: Preview → Approval → Commit.")}
        actions={can("optimization:run") ? <Button onClick={() => setRunOpen(true)} disabled={!params.weights}><Play />{t("تشغيل التحسين", "Run optimization")}</Button> : null}
      />
      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardHeader title={t("سجل التشغيلات", "Run history")} />
          {runs.isLoading ? <LoadingBlock /> : !runs.data?.length ? <EmptyState title={t("لا توجد تشغيلات", "No runs yet")} /> : (
            <ul className="scroll-thin max-h-[640px] divide-y divide-line-2 overflow-y-auto">
              {runs.data.map((x) => (
                <li key={x.id}>
                  <button onClick={() => { setRunId(x.id); router.replace(`/optimization?run=${x.id}`); }} className={cn("w-full px-4 py-3 text-start hover:bg-canvas", effectiveRun === x.id && "bg-teal-50/60")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium">{x.trigger === "MANUAL" ? t("يدوي", "Manual") : x.trigger}</span>
                      {x.jobStatus === "COMPLETED" ? <StatusBadge group="approval" value={x.approvalStatus} /> : <StatusBadge group="job" value={x.jobStatus} />}
                    </div>
                    <p className="num mt-0.5 text-[11.5px] text-muted">{f.dateTime(x.createdAt)} · {x.solverStatus ? label("solver", x.solverStatus, locale) : "—"}{x.objectiveValue !== null ? ` · ${f.num(x.objectiveValue)}` : ""}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          {!effectiveRun ? <Card><EmptyState icon={<GitBranch className="size-5" />} title={t("شغّل التحسين لإنشاء خطة مقترحة", "Run the optimiser to create a proposed plan")} /></Card> : run.isLoading ? <Card><LoadingBlock rows={8} /></Card> : run.error ? <Card><ErrorState error={run.error} onRetry={() => run.refetch()} /></Card> : r ? (
            <>
              <Card>
                <CardHeader
                  title={r.label ?? t("خطة مقترحة", "Proposed plan")}
                  subtitle={<span className="num">{r.solverVersion ?? "CP-SAT"} · {f.dateTime(r.createdAt)} · {t("المُحفز", "trigger")}: {r.trigger}</span>}
                  actions={
                    <>
                      {r.isStale && r.approvalStatus === "PENDING" ? <Badge tone="warn">{t("تغيرت الحالة منذ الحساب — سيُعاد التحقق عند الاعتماد", "State changed since solve — re-validated on approval")}</Badge> : null}
                      {r.jobStatus === "COMPLETED" ? <StatusBadge group="approval" value={r.approvalStatus} /> : <StatusBadge group="job" value={r.jobStatus} />}
                      {can("optimization:approve") && r.approvalStatus === "PENDING" && r.jobStatus === "COMPLETED" ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setDecision("reject")}><XCircle />{t("رفض", "Reject")}</Button>
                          <Button size="sm" variant="teal" onClick={() => setDecision("approve")}><CheckCircle2 />{t("اعتماد الخطة", "Approve plan")}</Button>
                        </>
                      ) : null}
                    </>
                  }
                />
                <CardBody>
                  {["QUEUED", "RUNNING"].includes(r.jobStatus) ? (
                    <div className="flex items-center gap-3 py-6 text-[13px] text-muted"><span className="size-3 animate-ping rounded-full bg-teal-500" />{t("المحلل يعمل في خدمة الذكاء… (مهمة خلفية)", "Solver running in the intelligence service… (background job)")}</div>
                  ) : r.jobStatus === "FAILED" ? (
                    <p className="rounded-lg bg-bad-bg px-3 py-2 text-[12.5px] text-bad">{r.error}</p>
                  ) : (
                    <div className="space-y-5">
                      <KeyValue cols={3} items={[
                        { k: t("حالة المحلل", "Solver status"), v: <StatusBadge group="solver" value={r.solverStatus} /> },
                        { k: t("قيمة دالة الهدف", "Objective value"), v: <span className="num">{f.num(r.objectiveValue)}</span> },
                        { k: t("الحد الأدنى المُثبت", "Best bound"), v: <span className="num">{f.num(r.bestBound)}{r.objectiveValue ? ` (${t("فجوة", "gap")} ${f.pct(Math.abs(r.objectiveValue - r.bestBound) / Math.max(1e-9, r.objectiveValue))})` : ""}</span> },
                        { k: t("زمن الحل", "Runtime"), v: <span className="num">{r.runtimeMs} ms</span> },
                        { k: t("متغيرات / قيود", "Variables / constraints"), v: <span className="num">{r.constraintSummary?.variables} / {r.constraintSummary?.constraints}</span> },
                        { k: t("التزامات ثابتة", "Fixed commitments"), v: <span className="num">{r.constraintSummary?.fixed_commitments}</span> },
                      ]} />
                      {r.constraintSummary?.message ? <p className="rounded-lg bg-warn-bg px-3 py-2 text-[12.5px] text-warn">{r.constraintSummary.message}</p> : null}
                      <div>
                        <p className="mb-2 text-[12px] font-semibold text-navy-800">{t("مقارنة الخطة الحالية بالمقترحة (نفس دالة الهدف)", "Current vs. proposed (same objective)")}</p>
                        <Table>
                          <thead><tr><Th>{t("المكوّن", "Component")}</Th><Th>{t("الحالية", "Current")}</Th><Th>{t("المقترحة", "Proposed")}</Th></tr></thead>
                          <tbody>
                            <tr><Td>{t("دقائق الانتظار", "Waiting minutes")}</Td><Td className="num">{f.num(cur.waiting_minutes)}</Td><Td className="num">{f.num(bd.waiting_minutes)}</Td></tr>
                            <tr><Td>{t("دقائق التأخر", "Tardiness minutes")}</Td><Td className="num">{f.num(cur.tardiness_minutes)}</Td><Td className="num">{f.num(bd.tardiness_minutes)}</Td></tr>
                            <tr><Td>{t("شاحنات بلا تخصيص صالح", "Trucks without a valid slot")}</Td><Td className="num">{f.num(cur.unassigned_count)}</Td><Td className="num">{f.num(bd.unassigned_count)}</Td></tr>
                            <tr><Td>{t("تعارضات (تداخل/رصيف معطل)", "Conflicts (overlap / dock down)")}</Td><Td className="num">{f.num(cur.conflicts)}</Td><Td className="num">0</Td></tr>
                            <tr><Td>{t("نهاية آخر خدمة (دقيقة من الآن)", "Last service ends (min from now)")}</Td><Td className="num">{f.num(cur.makespan_min)}</Td><Td className="num">{f.num(bd.makespan_min)}</Td></tr>
                            <tr><Td>{t("إعادات التخصيص", "Reassignments")}</Td><Td className="num">0</Td><Td className="num">{f.num(bd.reassignments)}</Td></tr>
                          </tbody>
                        </Table>
                        <p className="mt-1.5 text-[11.5px] text-muted">{t("«الحالية» تُقيَّم بالرصيف والموعد المؤكدين لكل شاحنة؛ الشاحنات بلا موعد مؤكد تُحسب بلا تخصيص.", "“Current” evaluates each truck's confirmed dock and slot; trucks without a confirmed slot count as unassigned.")}</p>
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>

              {r.jobStatus === "COMPLETED" ? (
                <Card>
                  <CardHeader title={t("التخصيصات وأسبابها", "Assignments and reasons")} subtitle={t("الأسباب مشتقة من حل المحلل والقيود الفعلية — وليست نصوصًا مولدة", "Reasons are derived from the solver output and actual constraints — not generated text")} />
                  {cands.length === 0 ? <EmptyState title={t("لا توجد شاحنات قابلة للتخطيط ضمن الأفق", "No plannable trucks within the horizon")} /> : (
                    <Table>
                      <thead><tr><Th>{t("الشاحنة", "Truck")}</Th><Th>{t("الرصيف", "Dock")}</Th><Th>{t("الفريق", "Team")}</Th><Th>{t("البدء", "Start")}</Th><Th>{t("الإزاحة", "Shift")}</Th><Th>{t("الانتظار/التأخر", "Wait / late")}</Th><Th>{t("السبب الرئيسي", "Main reason")}</Th><Th /></tr></thead>
                      <tbody>
                        {cands.map((c) => (
                          <tr key={c.id} className={cn(!c.assigned && "bg-bad-bg/30")}>
                            <Td><TruckLink id={c.truckId} code={c.truckCode} /></Td>
                            <Td className="num">{c.assigned ? <>{c.previousDockCode && c.previousDockCode !== c.dockCode ? <span className="text-muted line-through">{c.previousDockCode}</span> : null} <span className={cn(c.dockChanged && "font-semibold text-teal-700")}>{c.dockCode}</span></> : <Badge tone="bad">{t("بلا تخصيص", "Unassigned")}</Badge>}</Td>
                            <Td className="num">{c.teamCode ?? "—"}</Td>
                            <Td className="num">{f.time(c.startAt)}–{f.time(c.endAt)}</Td>
                            <Td className="num">{c.startShiftMin === null ? "—" : `${c.startShiftMin > 0 ? "+" : ""}${c.startShiftMin}`}</Td>
                            <Td className="num">{c.waitingMin ?? "—"} / {c.tardinessMin ?? "—"}</Td>
                            <Td className="max-w-xs text-[12px] text-ink-2"><span className="line-clamp-2">{(locale === "ar" ? c.reasons[0]?.ar : c.reasons[0]?.en) ?? "—"}</span></Td>
                            <Td><Button size="sm" variant="ghost" onClick={() => setInspect(c)}>{t("فحص القرار", "Inspect")}</Button></Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card>
              ) : null}

              <Card>
                <CardHeader title={t("دالة الهدف والأوزان المستخدمة", "Objective and weights used")} subtitle={t("الأوزان سياسة تشغيلية بوحدة «دقائق انتظار مكافئة»، وليست أوزانًا مثالية علميًا. تُضرب أوزان الانتظار والتأخر في معامل الأولوية (0.8–2.5).", "Weights are an operational policy in “equivalent waiting minutes”, not scientifically optimal values. Waiting/tardiness weights are multiplied by the priority factor (0.8–2.5).")} />
                <Table>
                  <thead><tr><Th>{t("الحد", "Term")}</Th><Th>{t("الوزن", "Weight")}</Th><Th>{t("الوحدة", "Unit")}</Th><Th>{t("المساهمة في هذه الخطة", "Contribution in this plan")}</Th></tr></thead>
                  <tbody>
                    {WEIGHT_META.map((w) => {
                      const key = { waitingPerMin: "waiting", tardinessPerMin: "tardiness", disruptionPerMin: "disruption", reassignment: "reassignment", makespanPerMin: "makespan", unassigned: "unassigned" }[w.key]!;
                      return <tr key={w.key}><Td>{locale === "ar" ? w.ar : w.en}</Td><Td className="num">{(r.params?.weights ?? {})[w.key]}</Td><Td className="text-muted">{locale === "ar" ? w.unit[0] : w.unit[1]}</Td><Td className="num">{f.num(bd[key])}</Td></tr>;
                    })}
                  </tbody>
                </Table>
              </Card>
            </>
          ) : null}
        </div>
      </div>

      <Dialog open={runOpen} onOpenChange={setRunOpen} wide title={t("معلمات التحسين", "Optimization parameters")} description={t("يُنشئ التشغيل خطة مقترحة فقط. الخطة لا تُطبق إلا بعد اعتماد مستخدم مخوّل، ويُعاد التحقق منها مقابل الحالة الحالية لحظة الاعتماد.", "A run only creates a proposal. It is applied only after approval by an authorised user, and is re-validated against the current state at approval time.")} footer={<><Button variant="outline" onClick={() => setRunOpen(false)}>{t("إلغاء", "Cancel")}</Button><Button loading={start.isPending} onClick={() => start.mutate()}><Play />{t("تشغيل", "Run")}</Button></>}>
        {params.weights ? (
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t("أفق التخطيط (دقيقة)", "Horizon (min)")} htmlFor="h"><Input id="h" type="number" dir="ltr" value={params.horizonMin} onChange={(e) => setParams({ ...params, horizonMin: Number(e.target.value) })} /></Field>
            <Field label={t("حد زمن المحلل (ث)", "Solver time limit (s)")} htmlFor="tl"><Input id="tl" type="number" step="0.5" dir="ltr" value={params.timeLimitSec} onChange={(e) => setParams({ ...params, timeLimitSec: Number(e.target.value) })} /></Field>
            <label className="mt-6 flex items-center gap-2 text-[12.5px]"><input type="checkbox" className="size-4" checked={params.allowUnassigned} onChange={(e) => setParams({ ...params, allowUnassigned: e.target.checked })} />{t("السماح بترك شاحنات بلا تخصيص (وإلا قد تكون النتيجة غير ممكنة)", "Allow unassigned trucks (otherwise the result may be infeasible)")}</label>
            {WEIGHT_META.map((w) => (
              <Field key={w.key} label={`${locale === "ar" ? w.ar : w.en} (${locale === "ar" ? w.unit[0] : w.unit[1]})`} htmlFor={w.key}>
                <Input id={w.key} type="number" step="0.1" dir="ltr" value={params.weights[w.key]} onChange={(e) => setParams({ ...params, weights: { ...params.weights, [w.key]: Number(e.target.value) } })} />
              </Field>
            ))}
          </div>
        ) : <LoadingBlock />}
      </Dialog>

      <Dialog open={!!inspect} onOpenChange={(o) => !o && setInspect(null)} title={inspect ? t(`لماذا هذا التخصيص؟ ${inspect.truckCode}`, `Why this assignment? ${inspect.truckCode}`) : ""}>
        {inspect ? (
          <div className="space-y-4">
            <ul className="space-y-2">{inspect.reasons.map((x: AnyRec, i: number) => <li key={i} className="flex gap-2 text-[13px]"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-500" />{locale === "ar" ? x.ar : x.en}</li>)}</ul>
            {inspect.alternatives?.length ? (
              <div>
                <p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("البدائل المتوافقة (أبكر بدء بالنظر للخطة المقترحة)", "Compatible alternatives (earliest start given the proposed plan)")}</p>
                <div className="flex flex-wrap gap-1.5">{inspect.alternatives.map((a: AnyRec) => <Badge key={a.dockId} tone="info"><span className="num">{a.dockCode} · {f.time(a.earliestStart)}</span></Badge>)}</div>
              </div>
            ) : <p className="text-[12px] text-muted">{t("لا توجد أرصفة متوافقة بديلة.", "No alternative compatible docks.")}</p>}
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)} title={decision === "approve" ? t("اعتماد الخطة وتطبيقها؟", "Approve and apply the plan?") : t("رفض الخطة؟", "Reject the plan?")} description={decision === "approve" ? t("ستُحدَّث المواعيد والأرصفة المخصصة للشاحنات في معاملة واحدة بعد إعادة التحقق. لا يُصدر أي استدعاء — يظل الاستدعاء خاضعًا لمحرك الجاهزية.", "Appointments and dock assignments are updated in one transaction after re-validation. No truck is called — release still goes through the readiness engine.") : undefined} confirmLabel={decision === "approve" ? t("اعتماد", "Approve") : t("رفض", "Reject")} tone={decision === "approve" ? "teal" : "danger"} loading={decide.isPending} onConfirm={(reason) => decide.mutate({ kind: decision!, reason })} />
    </>
  );
}

export default function OptimizationPage() {
  return (
    <Suspense>
      <OptimizationInner />
    </Suspense>
  );
}
