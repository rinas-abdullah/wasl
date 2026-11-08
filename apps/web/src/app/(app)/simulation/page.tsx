"use client";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ErrorBar, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { FlaskConical, Play, Repeat, Square } from "lucide-react";
import { SIMULATION_POLICIES, SIMULATION_PRESETS, presetParams, type SimulationParams, type SimulationPolicy, type SimulationPreset } from "@wasl/shared";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, LoadingBlock, PageHeader, Select, StatusBadge, SyntheticBadge, Table, Tabs, Td, Th } from "@/components/ui";
import type { AnyRec } from "@/components/domain";
import { cn } from "@/lib/utils";

const POLICY_COLORS: Record<string, string> = { FCFS: "#94a3b8", FIXED_APPOINTMENTS: "#c08a2c", OR_ONLY: "#1d5584", FULL_WASL: "#18bdb5" };
const METRICS: { key: string; ar: string; en: string; better: "low" | "high"; pct?: boolean }[] = [
  { key: "avg_wait_min", ar: "متوسط الانتظار في الموقع (د)", en: "Avg on-site waiting (min)", better: "low" },
  { key: "median_wait_min", ar: "وسيط الانتظار (د)", en: "Median waiting (min)", better: "low" },
  { key: "p95_wait_min", ar: "الانتظار P95 (د)", en: "P95 waiting (min)", better: "low" },
  { key: "avg_total_delay_min", ar: "التأخير الكلي من الوصول الطبيعي (د)", en: "Total delay from natural arrival (min)", better: "low" },
  { key: "avg_turnaround_min", ar: "زمن الدورة في الموقع (د)", en: "On-site turnaround (min)", better: "low" },
  { key: "avg_queue_length", ar: "متوسط طول طابور الساحة", en: "Avg yard queue length", better: "low" },
  { key: "max_queue_length", ar: "أقصى طول للطابور", en: "Max queue length", better: "low" },
  { key: "dock_utilization", ar: "استغلال الأرصفة", en: "Dock utilisation", better: "high", pct: true },
  { key: "team_utilization", ar: "استغلال الفرق", en: "Team utilisation", better: "high", pct: true },
  { key: "avg_quality_response_min", ar: "زمن استجابة الجودة (د)", en: "Quality response (min)", better: "low" },
  { key: "schedule_changes", ar: "تغييرات الجدول", en: "Schedule changes", better: "low" },
  { key: "makespan_min", ar: "نهاية آخر خدمة (د)", en: "Makespan (min)", better: "low" },
];

function SimulationInner() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(sp.get("scenario"));
  const [builderOpen, setBuilderOpen] = useState(false);
  const [preset, setPreset] = useState<SimulationPreset>("DOCK_FAILURE");
  const [params, setParams] = useState<SimulationParams>(presetParams("DOCK_FAILURE"));
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(20261108);
  const [reps, setReps] = useState(3);
  const [policies, setPolicies] = useState<SimulationPolicy[]>([...SIMULATION_POLICIES]);
  const [eventsRun, setEventsRun] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState("avg_wait_min");

  const list = useQuery({ queryKey: ["simulation", "list"], queryFn: () => api.get<AnyRec[]>("/api/simulations/scenarios"), refetchInterval: (q) => (q.state.data?.some((s) => s.completedRuns < s.totalRuns) ? 3000 : false) });
  const current = selected ?? list.data?.[0]?.id ?? null;
  const detail = useQuery({ queryKey: ["simulation", "detail", current], queryFn: () => api.get<AnyRec>(`/api/simulations/scenarios/${current}`), enabled: !!current, refetchInterval: (q) => (q.state.data?.job && ["QUEUED", "RUNNING"].includes(q.state.data.job.status) ? 2000 : false) });
  const events = useQuery({ queryKey: ["simulation", "events", eventsRun], queryFn: () => api.get<AnyRec>(`/api/simulations/runs/${eventsRun}/events`), enabled: !!eventsRun });

  const create = useMutation({
    mutationFn: () => api.post<AnyRec>("/api/simulations/runs", { scenarioName: name || label("preset", preset, locale), preset, seed, replications: reps, policies, params }),
    onSuccess: (r) => {
      setSelected(r.scenario.id);
      router.replace(`/simulation?scenario=${r.scenario.id}`);
      setBuilderOpen(false);
      qc.invalidateQueries({ queryKey: ["simulation"] });
      toast.info(t(`أُضيفت ${r.runs} تشغيلات إلى طابور المهام`, `${r.runs} runs queued`));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const rerun = useMutation({
    mutationFn: () => api.post<AnyRec>(`/api/simulations/scenarios/${current}/rerun`),
    onSuccess: (r) => {
      setSelected(r.scenario.id);
      router.replace(`/simulation?scenario=${r.scenario.id}`);
      qc.invalidateQueries({ queryKey: ["simulation"] });
      toast.info(t("أعيد التشغيل بنفس المدخلات والبذرة — قارن النتائج للتحقق من قابلية الإعادة", "Re-run with identical inputs and seed — compare results to verify reproducibility"));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const cancel = useMutation({ mutationFn: () => api.post(`/api/simulations/scenarios/${current}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["simulation"] }), onError: (e) => toast.error((e as Error).message) });

  const d = detail.data;
  const summary: AnyRec[] = d?.summary ?? [];
  const running = d?.job && ["QUEUED", "RUNNING"].includes(d.job.status);
  const twin = useMemo(() => {
    if (!d || !list.data) return null;
    const base = d.name.replace(/ \(re-run\)$/, "");
    return list.data.find((s) => s.id !== d.id && s.seed === d.seed && JSON.stringify(s.params) === JSON.stringify(d.params) && s.name.replace(/ \(re-run\)$/, "") === base && s.completedRuns === s.totalRuns) ?? null;
  }, [d, list.data]);
  const twinDetail = useQuery({ queryKey: ["simulation", "detail", twin?.id], queryFn: () => api.get<AnyRec>(`/api/simulations/scenarios/${twin!.id}`), enabled: !!twin });
  const reproducible = useMemo(() => {
    if (!twinDetail.data || !d || running) return null;
    const key = (runs: AnyRec[]) => JSON.stringify(runs.filter((r) => r.jobStatus === "COMPLETED").map((r) => [r.policy, r.replication, r.metrics]).sort());
    return key(twinDetail.data.runs) === key(d.runs);
  }, [twinDetail.data, d, running]);

  const chartData = summary.map((s) => ({ policy: label("policy", s.policy, locale), mean: s.stats[chartMetric]?.mean ?? 0, ci: s.stats[chartMetric]?.ci95 ?? 0, fill: POLICY_COLORS[s.policy] }));
  const queueSeries = useMemo(() => {
    if (!d) return [];
    const byT: Record<number, AnyRec> = {};
    for (const r of d.runs.filter((x: AnyRec) => x.replication === 0 && x.timeseries?.queue)) for (const p of r.timeseries.queue) (byT[p.t] ??= { t: p.t })[r.policy] = p.queue;
    return Object.values(byT).sort((a, b) => a.t - b.t);
  }, [d]);

  return (
    <>
      <PageHeader
        title={t("مختبر المحاكاة", "Simulation lab")}
        description={t("محاكاة أحداث متقطعة بمكتبة SimPy لاختبار القرار قبل اعتماده. كل سياسة تُشغّل على نفس العالم العشوائي داخل كل تكرار (أرقام عشوائية مشتركة)، وتُحفظ المدخلات والبذرة والإصدار وسجل الأحداث لإعادة الإنتاج.", "Discrete-event simulation with SimPy to test decisions before committing them. Every policy runs on the same random world within a replication (common random numbers); inputs, seed, version and event log are stored for reproduction.")}
        badges={<SyntheticBadge kind="simulation" />}
        actions={can("simulation:run") ? <Button onClick={() => setBuilderOpen(true)}><FlaskConical />{t("سيناريو جديد", "New scenario")}</Button> : null}
      />
      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardHeader title={t("التجارب", "Experiments")} />
          {list.isLoading ? <LoadingBlock /> : !list.data?.length ? <EmptyState title={t("لا توجد تجارب", "No experiments")} /> : (
            <ul className="scroll-thin max-h-[680px] divide-y divide-line-2 overflow-y-auto">
              {list.data.map((s) => (
                <li key={s.id}>
                  <button onClick={() => { setSelected(s.id); router.replace(`/simulation?scenario=${s.id}`); }} className={cn("w-full px-4 py-3 text-start hover:bg-canvas", current === s.id && "bg-teal-50/60")}>
                    <p className="text-[12.5px] font-medium">{s.name}</p>
                    <p className="num mt-0.5 text-[11.5px] text-muted">seed {s.seed} · ×{s.replications} · {s.completedRuns}/{s.totalRuns} · {f.dateTime(s.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          {!current ? <Card><EmptyState icon={<FlaskConical className="size-5" />} title={t("أنشئ سيناريو لمقارنة السياسات", "Create a scenario to compare policies")} /></Card> : detail.isLoading ? <Card><LoadingBlock rows={8} /></Card> : detail.error ? <Card><ErrorState error={detail.error} /></Card> : d ? (
            <>
              <Card>
                <CardHeader
                  title={d.name}
                  subtitle={<span className="num">{d.preset ? label("preset", d.preset, locale) : t("مخصص", "Custom")} · seed {d.seed} · {d.replications} {t("تكرارات", "replications")} · {d.runs[0]?.simVersion ?? "—"}</span>}
                  actions={
                    <>
                      {d.job ? <StatusBadge group="job" value={d.job.status} /> : null}
                      {running && can("simulation:run") ? <Button size="sm" variant="dangerOutline" onClick={() => cancel.mutate()}><Square />{t("إلغاء", "Cancel")}</Button> : null}
                      {!running && can("simulation:run") ? <Button size="sm" variant="outline" loading={rerun.isPending} onClick={() => rerun.mutate()}><Repeat />{t("إعادة التشغيل للتحقق", "Re-run to verify")}</Button> : null}
                    </>
                  }
                />
                <CardBody className="space-y-4">
                  {running ? (
                    <div>
                      <div className="mb-1.5 flex justify-between text-[12px] text-muted"><span>{t("تشغيل المحاكاة في الخلفية…", "Running simulation in the background…")}</span><span className="num">{Math.round((d.job.progress ?? 0) * 100)}%</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-line-2"><div className="h-full bg-teal-500 transition-all" style={{ width: `${Math.round((d.job.progress ?? 0) * 100)}%` }} /></div>
                    </div>
                  ) : null}
                  {reproducible !== null ? (
                    <p className={cn("rounded-lg px-3 py-2 text-[12.5px]", reproducible ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad")}>
                      {reproducible ? t(`قابلية الإعادة: النتائج مطابقة تمامًا للتجربة «${twin?.name}» بنفس المدخلات والبذرة.`, `Reproducibility: results are identical to “${twin?.name}” with the same inputs and seed.`) : t("تحذير: النتائج تختلف عن تجربة بنفس المدخلات — راجع الإصدارات.", "Warning: results differ from an experiment with identical inputs — check versions.")}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5 text-[11.5px]">
                    {[
                      [t("شاحنات", "trucks"), d.params.nTrucks], [t("أرصفة", "docks"), d.params.nDocks], [t("مبردة", "reefer"), d.params.nReeferDocks], [t("فرق", "teams"), d.params.nTeams], [t("مفتشون", "inspectors"), d.params.nInspectors], [t("المدة", "duration"), `${d.params.durationMin}m`], [t("نمط الوصول", "arrivals"), d.params.arrival.pattern], [t("تأخر", "lateness"), `${d.params.arrival.latenessMeanMin}±${d.params.arrival.latenessSdMin}`], ["CV", d.params.service.cv], [t("جودة", "quality p"), d.params.qualityProbability], [t("أعطال", "failures"), d.params.failures.length],
                    ].map(([k, v]) => <Badge key={String(k)} tone="neutral"><span className="num">{k}: {String(v)}</span></Badge>)}
                  </div>
                </CardBody>
              </Card>

              {summary.some((s) => s.completed > 0) ? (
                <>
                  <Card>
                    <CardHeader title={t("مقارنة السياسات (المتوسط ± فترة ثقة 95%)", "Policy comparison (mean ± 95% CI)")} subtitle={t("القيم الأفضل في كل صف مظللة. لا تُعرض أي نتيجة غير ناتجة عن تشغيل فعلي.", "Best value per row is highlighted. Nothing is shown that did not come from an actual run.")} />
                    <Table>
                      <thead><tr><Th>{t("المؤشر", "Metric")}</Th>{summary.map((s) => <Th key={s.policy}><span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: POLICY_COLORS[s.policy] }} />{label("policy", s.policy, locale)} <span className="num text-muted">n={s.completed}</span></span></Th>)}</tr></thead>
                      <tbody>
                        {METRICS.map((m) => {
                          const vals = summary.map((s) => s.stats[m.key]?.mean).filter((x) => x !== undefined) as number[];
                          const best = m.better === "low" ? Math.min(...vals) : Math.max(...vals);
                          return (
                            <tr key={m.key}>
                              <Td className="text-ink-2">{locale === "ar" ? m.ar : m.en}</Td>
                              {summary.map((s) => {
                                const st = s.stats[m.key];
                                return <Td key={s.policy} className={cn("num", st && Math.abs(st.mean - best) < 1e-9 && "bg-teal-50 font-semibold text-teal-700")}>{st ? (m.pct ? f.pct(st.mean) : f.num(st.mean)) : "—"}{st?.ci95 ? <span className="text-[11px] text-muted"> ±{m.pct ? f.pct(st.ci95) : f.num(st.ci95)}</span> : null}</Td>;
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                    <p className="px-5 py-3 text-[11.5px] leading-relaxed text-muted">{t("تفسير: سياسة وَصل تحتجز الشاحنات خارج الموقع حتى جاهزية الرصيف، فتخفض الانتظار والازدحام داخل الساحة، لكنها قد تزيد «التأخير الكلي» أو تخفض الاستغلال في بعض السيناريوهات. هذه نتائج على بيانات اصطناعية ولا تثبت الأداء في مستودع حقيقي.", "Interpretation: WASL holds trucks off-site until the dock is ready, reducing on-site waiting and yard congestion, but it can increase total delay or lower utilisation in some scenarios. These are results on synthetic data and do not prove performance in a real warehouse.")}</p>
                  </Card>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader title={t("رسم المقارنة", "Comparison chart")} actions={<Select className="h-8 w-auto text-[12px]" value={chartMetric} onChange={(e) => setChartMetric(e.target.value)}>{METRICS.map((m) => <option key={m.key} value={m.key}>{locale === "ar" ? m.ar : m.en}</option>)}</Select>} />
                      <CardBody>
                        <div className="h-64" dir="ltr">
                          <ResponsiveContainer>
                            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                              <CartesianGrid stroke="#eef2f6" vertical={false} />
                              <XAxis dataKey="policy" tick={{ fontSize: 11, fill: "#637487" }} reversed={locale === "ar"} />
                              <YAxis tick={{ fontSize: 11, fill: "#637487" }} orientation={locale === "ar" ? "right" : "left"} />
                              <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                              <Bar dataKey="mean" radius={[6, 6, 0, 0]} maxBarSize={56} fill="#18bdb5" isAnimationActive={false}>
                                <ErrorBar dataKey="ci" width={6} stroke="#0b2e52" />
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardBody>
                    </Card>
                    <Card>
                      <CardHeader title={t("طول طابور الساحة عبر الزمن (التكرار 1)", "Yard queue over time (replication 1)")} />
                      <CardBody>
                        <div className="h-64" dir="ltr">
                          <ResponsiveContainer>
                            <LineChart data={queueSeries} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                              <CartesianGrid stroke="#eef2f6" vertical={false} />
                              <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#637487" }} unit="m" reversed={locale === "ar"} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#637487" }} orientation={locale === "ar" ? "right" : "left"} />
                              <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                              {summary.map((s) => <Line key={s.policy} dataKey={s.policy} name={label("policy", s.policy, locale)} stroke={POLICY_COLORS[s.policy]} dot={false} strokeWidth={2} type="stepAfter" isAnimationActive={false} />)}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </CardBody>
                    </Card>
                  </div>
                </>
              ) : null}

              <Card>
                <CardHeader title={t("التشغيلات الفردية (قابلة لإعادة الإنتاج)", "Individual runs (reproducible)")} />
                <Table>
                  <thead><tr><Th>{t("السياسة", "Policy")}</Th><Th>{t("التكرار", "Rep.")}</Th><Th>Seed</Th><Th>{t("الحالة", "Status")}</Th><Th>{t("الانتظار", "Wait")}</Th><Th>{t("الأحداث", "Events")}</Th><Th>{t("مدة الخدمة المستخدمة", "Service estimate used")}</Th><Th>{t("الزمن", "Runtime")}</Th><Th /></tr></thead>
                  <tbody>
                    {d.runs.map((r: AnyRec) => (
                      <tr key={r.id}>
                        <Td>{label("policy", r.policy, locale)}</Td><Td className="num">{r.replication + 1}</Td><Td className="num">{r.seed}</Td>
                        <Td><StatusBadge group="job" value={r.jobStatus} />{r.error ? <p className="max-w-xs truncate text-[11px] text-bad" title={r.error}>{r.error}</p> : null}</Td>
                        <Td className="num">{r.metrics ? f.num(r.metrics.avg_wait_min) : "—"}</Td><Td className="num">{r.eventCount ?? "—"}</Td>
                        <Td className="text-[11.5px] text-muted">{r.policy === "FULL_WASL" ? r.timeseries?.modelUsed ?? "—" : "BASELINE"}</Td>
                        <Td className="num">{r.runtimeMs ? `${(r.runtimeMs / 1000).toFixed(1)}s` : "—"}</Td>
                        <Td>{r.eventCount ? <Button size="sm" variant="ghost" onClick={() => setEventsRun(r.id)}>{t("سجل الأحداث", "Event log")}</Button> : null}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </>
          ) : null}
        </div>
      </div>

      <Dialog open={builderOpen} onOpenChange={setBuilderOpen} wide title={t("منشئ السيناريو", "Scenario builder")} description={t("اختر سيناريو جاهزًا ثم عدّل المعلمات. المحاكاة لا تعتمد على أي بيانات تشغيلية حقيقية.", "Pick a preset then adjust parameters. The simulation does not use any real operational data.")} footer={<><Button variant="outline" onClick={() => setBuilderOpen(false)}>{t("إلغاء", "Cancel")}</Button><Button loading={create.isPending} disabled={!policies.length} onClick={() => create.mutate()}><Play />{t(`تشغيل ${policies.length * reps} تشغيلات`, `Run ${policies.length * reps} runs`)}</Button></>}>
        <div className="space-y-4">
          <Tabs value={preset} onValueChange={(v) => { setPreset(v as SimulationPreset); setParams(presetParams(v as SimulationPreset)); }} items={SIMULATION_PRESETS.map((p) => ({ value: p, label: label("preset", p, locale) }))} className="overflow-x-auto" />
          <div className="grid gap-3 md:grid-cols-4">
            <Field label={t("اسم السيناريو", "Scenario name")} htmlFor="sn" className="md:col-span-2"><Input id="sn" value={name} placeholder={label("preset", preset, locale)} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t("البذرة العشوائية", "Random seed")} htmlFor="seed"><Input id="seed" type="number" dir="ltr" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></Field>
            <Field label={t("التكرارات", "Replications")} htmlFor="reps"><Input id="reps" type="number" min={1} max={10} dir="ltr" value={reps} onChange={(e) => setReps(Number(e.target.value))} /></Field>
            {([
              ["durationMin", t("مدة المحاكاة (د)", "Duration (min)")], ["nTrucks", t("عدد الشاحنات", "Trucks")], ["nDocks", t("الأرصفة", "Docks")], ["nReeferDocks", t("أرصفة مبردة", "Reefer docks")],
              ["nTeams", t("فرق العمل", "Teams")], ["nInspectors", t("المفتشون", "Inspectors")], ["yardCapacity", t("سعة الساحة", "Yard capacity")], ["travelMin", t("زمن الطريق (د)", "Travel (min)")],
              ["inspectionMin", t("زمن الفحص (د)", "Inspection (min)")], ["coldShare", t("نسبة المبرد", "Cold share")], ["qualityProbability", t("احتمال فحص الجودة", "Quality probability")],
            ] as [keyof SimulationParams, string][]).map(([k, l]) => (
              <Field key={k} label={l} htmlFor={k}><Input id={k} type="number" step="any" dir="ltr" value={params[k] as number} onChange={(e) => setParams({ ...params, [k]: Number(e.target.value) })} /></Field>
            ))}
            <Field label={t("نمط الوصول", "Arrival distribution")} htmlFor="ap"><Select id="ap" value={params.arrival.pattern} onChange={(e) => setParams({ ...params, arrival: { ...params.arrival, pattern: e.target.value as SimulationParams["arrival"]["pattern"] } })}><option value="UNIFORM_APPOINTMENTS">{t("مواعيد موزعة", "Uniform appointments")}</option><option value="PEAKED_APPOINTMENTS">{t("مواعيد مع ذروة", "Peaked appointments")}</option></Select></Field>
            <Field label={t("متوسط التأخر (د)", "Lateness mean (min)")} htmlFor="lm"><Input id="lm" type="number" dir="ltr" value={params.arrival.latenessMeanMin} onChange={(e) => setParams({ ...params, arrival: { ...params.arrival, latenessMeanMin: Number(e.target.value) } })} /></Field>
            <Field label={t("انحراف التأخر (د)", "Lateness SD (min)")} htmlFor="ls"><Input id="ls" type="number" dir="ltr" value={params.arrival.latenessSdMin} onChange={(e) => setParams({ ...params, arrival: { ...params.arrival, latenessSdMin: Number(e.target.value) } })} /></Field>
            <Field label={t("توزيع زمن الخدمة", "Service-time distribution")} htmlFor="sd"><Select id="sd" value={params.service.distribution} onChange={(e) => setParams({ ...params, service: { ...params.service, distribution: e.target.value as "LOGNORMAL" | "TRIANGULAR" } })}><option value="LOGNORMAL">Lognormal</option><option value="TRIANGULAR">Triangular</option></Select></Field>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("أحداث الأعطال", "Failure events")}</p>
            {params.failures.length ? <ul className="space-y-1 text-[12px]">{params.failures.map((fl, i) => <li key={i} className="num">{fl.kind} #{fl.index + 1} · t={fl.atMin}m · {fl.durationMin}m <button className="ms-2 text-bad hover:underline" onClick={() => setParams({ ...params, failures: params.failures.filter((_, j) => j !== i) })}>{t("حذف", "remove")}</button></li>)}</ul> : <p className="text-[12px] text-muted">{t("لا أعطال", "No failures")}</p>}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setParams({ ...params, failures: [...params.failures, { kind: "DOCK", index: 0, atMin: 120, durationMin: 90 }] })}>{t("إضافة تعطل رصيف", "Add dock failure")}</Button>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("السياسات المقارنة", "Policies to compare")}</p>
            <div className="flex flex-wrap gap-3">{SIMULATION_POLICIES.map((p) => <label key={p} className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" className="size-4" checked={policies.includes(p)} onChange={() => setPolicies((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))} />{label("policy", p, locale)}</label>)}</div>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!eventsRun} onOpenChange={(o) => !o && setEventsRun(null)} wide title={t("سجل أحداث المحاكاة", "Simulation event log")} description={events.data ? <span className="num">{label("policy", events.data.run.policy, locale)} · seed {events.data.run.seed} · {events.data.events.length} {t("حدث", "events")}</span> : undefined}>
        {events.isLoading ? <LoadingBlock /> : events.data ? (
          <Table className="max-h-[60vh]">
            <thead><tr><Th>t (min)</Th><Th>{t("الحدث", "Event")}</Th><Th>{t("الشاحنة", "Truck")}</Th><Th>{t("الرصيف", "Dock")}</Th><Th>{t("تفاصيل", "Details")}</Th></tr></thead>
            <tbody>{events.data.events.slice(0, 400).map((e: AnyRec) => <tr key={e.id}><Td className="num">{e.tMin.toFixed(1)}</Td><Td><code className="text-[11.5px]">{e.eventType}</code></Td><Td className="num">{e.truckRef ?? ""}</Td><Td className="num">{e.dockRef ?? ""}</Td><Td className="num text-[11px] text-muted">{Object.keys(e.payload ?? {}).length ? JSON.stringify(e.payload) : ""}</Td></tr>)}</tbody>
          </Table>
        ) : null}
      </Dialog>
    </>
  );
}

export default function SimulationPage() {
  return (
    <Suspense>
      <SimulationInner />
    </Suspense>
  );
}
