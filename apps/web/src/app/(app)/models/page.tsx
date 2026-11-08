"use client";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, KeyValue, LoadingBlock, PageHeader, SyntheticBadge, Table, Td, Th } from "@/components/ui";
import type { AnyRec } from "@/components/domain";

export default function ModelsPage() {
  const t = useT();
  const f = useFormat();
  const q = useQuery({ queryKey: ["models"], queryFn: () => api.get<AnyRec>("/api/models") });
  if (q.isLoading) return <Card><LoadingBlock rows={8} /></Card>;
  if (q.error) return <Card><ErrorState error={q.error} /></Card>;
  const models: AnyRec[] = q.data!.models;
  return (
    <>
      <PageHeader title={t("سجل النماذج", "Model registry")} description={t("الذكاء الاصطناعي منفصل عن التحسين والمحاكاة: يقدّر مدة الخدمة وخطر الاختناق فقط، ولا يصدر قرار الاستدعاء ولا يتجاوز قيود السلامة. إذا لم يتفوق النموذج على خط الأساس، يُستخدم خط الأساس ويُعرض ذلك صراحة.", "AI is separate from optimisation and simulation: it only estimates service time and congestion risk, never issues release decisions or bypasses safety constraints. If a model does not beat its baseline, the baseline is used and shown as such.")} badges={<SyntheticBadge kind="model" />} />
      {!q.data!.intelligenceReachable ? <Card className="mb-4 border-warn/40 bg-warn-bg/40 px-5 py-3 text-[12.5px] text-warn">{t("خدمة الذكاء غير متاحة حاليًا — تُعرض آخر نسخة مسجلة، وتُستخدم جداول تخطيط معلنة لتقدير مدة الخدمة.", "Intelligence service unreachable — showing the last registered versions; declared planning tables are used for service-time estimates.")}</Card> : null}
      {models.length === 0 ? <Card><EmptyState title={t("لا نماذج مسجلة", "No registered models")} /></Card> : (
        <div className="space-y-4">
          {models.filter((m) => m.isActive).map((m) => {
            const isReg = m.modelName === "service_time";
            const cm = m.metrics["confusion_matrix_at_0.5"];
            return (
              <Card key={m.id}>
                <CardHeader title={<span className="flex items-center gap-2">{isReg ? t("النموذج 01 — تقدير مدة الخدمة", "Model 01 — Service-time prediction") : t("النموذج 02 — خطر الاختناق", "Model 02 — Congestion risk")}<Badge tone="teal">v{m.version}</Badge>{m.isActive ? <Badge tone="ok">{t("نشط", "Active")}</Badge> : null}</span>} subtitle={m.label} actions={m.beatsBaseline ? <Badge tone="ok">{t("يتفوق على خط الأساس", "Beats baseline")}</Badge> : <Badge tone="bad">{t("لا يتفوق — يُستخدم خط الأساس", "Does not beat baseline — baseline served")}</Badge>} />
                <CardBody className="space-y-5">
                  <KeyValue cols={3} items={[{ k: t("الخوارزمية", "Algorithm"), v: m.algorithm }, { k: t("مصدر البيانات", "Dataset source"), v: m.datasetSource }, { k: t("تاريخ التدريب", "Training date"), v: <span className="num">{f.dateTime(m.trainingDate)}</span> }, { k: t("حجم التدريب / الاختبار", "Train / test size"), v: <span className="num">{m.metrics.n_train} / {m.metrics.n_test}</span> }, { k: t("الخصائص", "Features"), v: (m.details?.features ?? []).join(", ") }, { k: t("خط الأساس", "Baseline"), v: m.baselineMetrics.name }]} />
                  {isReg ? (
                    <Table>
                      <thead><tr><Th>{t("المقياس (بيانات اختبار مستقلة)", "Metric (held-out test set)")}</Th><Th>{t("النموذج", "Model")}</Th><Th>{t("خط الأساس", "Baseline")}</Th></tr></thead>
                      <tbody>
                        <tr><Td>MAE ({t("دقيقة", "min")})</Td><Td className="num font-semibold">{f.num(m.metrics.mae)}</Td><Td className="num">{f.num(m.baselineMetrics.mae)}</Td></tr>
                        <tr><Td>RMSE ({t("دقيقة", "min")})</Td><Td className="num font-semibold">{f.num(m.metrics.rmse)}</Td><Td className="num">{f.num(m.baselineMetrics.rmse)}</Td></tr>
                        <tr><Td>{t("تغطية فترة 80% (P10–P90)", "80% interval coverage (P10–P90)")}</Td><Td className="num">{f.pct(m.metrics.interval_80_coverage)}</Td><Td className="num">—</Td></tr>
                      </tbody>
                    </Table>
                  ) : (
                    <div className="grid gap-5 lg:grid-cols-2">
                      <Table>
                        <thead><tr><Th>{t("المقياس", "Metric")}</Th><Th>{t("النموذج", "Model")}</Th><Th>{t("خط الأساس", "Baseline")}</Th></tr></thead>
                        <tbody>
                          <tr><Td>Brier score</Td><Td className="num font-semibold">{m.metrics.brier.toFixed(3)}</Td><Td className="num">{m.baselineMetrics.brier.toFixed(3)}</Td></tr>
                          <tr><Td>ROC AUC</Td><Td className="num">{m.metrics.roc_auc.toFixed(3)}</Td><Td className="num">{m.baselineMetrics.roc_auc.toFixed(3)}</Td></tr>
                          <tr><Td>Log loss</Td><Td className="num">{m.metrics.log_loss.toFixed(3)}</Td><Td className="num">—</Td></tr>
                          <tr><Td>Precision @0.5</Td><Td className="num">{f.pct(m.metrics["precision_at_0.5"])}</Td><Td className="num">—</Td></tr>
                          <tr><Td>Recall @0.5</Td><Td className="num">{f.pct(m.metrics["recall_at_0.5"])}</Td><Td className="num">—</Td></tr>
                          <tr><Td>{t("نسبة الحالات الإيجابية", "Prevalence")}</Td><Td className="num">{f.pct(m.metrics.prevalence)}</Td><Td className="num">—</Td></tr>
                        </tbody>
                      </Table>
                      <div>
                        <p className="mb-1 text-[12px] font-semibold text-navy-800">{t("منحنى المعايرة", "Calibration")}</p>
                        <div className="h-44" dir="ltr">
                          <ResponsiveContainer><LineChart data={m.metrics.calibration} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}><CartesianGrid stroke="#eef2f6" /><XAxis dataKey="predicted" type="number" domain={[0, 1]} tick={{ fontSize: 10 }} /><YAxis domain={[0, 1]} tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} /><ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#94a3b8" strokeDasharray="4 4" /><Line dataKey="observed" stroke="#18bdb5" strokeWidth={2} isAnimationActive={false} /></LineChart></ResponsiveContainer>
                        </div>
                        {cm ? <table className="num mt-3 text-[12px]"><tbody><tr><td className="p-1 text-muted" /><td className="p-1 text-muted">{t("متوقع لا", "pred 0")}</td><td className="p-1 text-muted">{t("متوقع نعم", "pred 1")}</td></tr><tr><td className="p-1 text-muted">{t("فعلي لا", "true 0")}</td><td className="rounded bg-ok-bg p-1 px-3">{cm.matrix[0][0]}</td><td className="rounded bg-bad-bg p-1 px-3">{cm.matrix[0][1]}</td></tr><tr><td className="p-1 text-muted">{t("فعلي نعم", "true 1")}</td><td className="rounded bg-bad-bg p-1 px-3">{cm.matrix[1][0]}</td><td className="rounded bg-ok-bg p-1 px-3">{cm.matrix[1][1]}</td></tr></tbody></table> : null}
                      </div>
                    </div>
                  )}
                  <p className="rounded-lg bg-warn-bg px-3 py-2 text-[12px] leading-relaxed text-warn">{t("بيانات تدريب اصطناعية — نموذج تجريبي. الأداء على بيانات مولدة من عملية معلنة لا يثبت الدقة في مستودع حقيقي، والنموذج ليس جاهزًا للإنتاج.", "Synthetic training data — experimental model. Performance on data generated from a declared process does not prove accuracy in a real warehouse; the model is not production-ready.")}</p>
                </CardBody>
              </Card>
            );
          })}
          <Card>
            <CardHeader title={t("كل الإصدارات", "All versions")} />
            <Table><thead><tr><Th>{t("النموذج", "Model")}</Th><Th>{t("الإصدار", "Version")}</Th><Th>{t("التدريب", "Trained")}</Th><Th>{t("نشط", "Active")}</Th><Th>{t("يتفوق على الأساس", "Beats baseline")}</Th></tr></thead><tbody>{models.map((m) => <tr key={m.id}><Td>{m.modelName}</Td><Td className="num">{m.version}</Td><Td className="num">{f.dateTime(m.trainingDate)}</Td><Td>{m.isActive ? "✓" : "—"}</Td><Td>{m.beatsBaseline ? "✓" : "✗"}</Td></tr>)}</tbody></Table>
          </Card>
        </div>
      )}
    </>
  );
}
