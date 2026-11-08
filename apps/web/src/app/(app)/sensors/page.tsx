"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { RotateCcw, Thermometer, Zap, WifiOff, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, LoadingBlock, PageHeader, Select, StatusBadge, SyntheticBadge, Table, Td, Th } from "@/components/ui";
import type { AnyRec } from "@/components/domain";

function SensorsInner() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const [shipmentId, setShipmentId] = useState(sp.get("shipment") ?? "");
  const [seed, setSeed] = useState("");
  const [streamId, setStreamId] = useState<string | null>(null);
  const shipments = useQuery({ queryKey: ["sensors", "shipments"], queryFn: () => api.get<AnyRec[]>("/api/shipments") });
  const streams = useQuery({ queryKey: ["sensors", "streams", shipmentId], queryFn: () => api.get<AnyRec[]>(`/api/virtual-sensors/shipments/${shipmentId}/streams`), enabled: !!shipmentId });
  const current = streamId ?? streams.data?.[0]?.id ?? null;
  const stream = useQuery({ queryKey: ["sensors", "stream", current], queryFn: () => api.get<AnyRec>(`/api/virtual-sensors/streams/${current}`), enabled: !!current });
  useEffect(() => setStreamId(null), [shipmentId]);

  const gen = useMutation({
    mutationFn: (scenario: string) => api.post<AnyRec>("/api/virtual-sensors/scenarios", { shipmentId, scenario, seed: seed ? Number(seed) : undefined, journeyMinutes: 360 }),
    onSuccess: (r) => {
      setStreamId(r.stream.id);
      qc.invalidateQueries();
      if (r.reviewId) toast.warning(t(`رُصد ${r.events.length} حدث يتطلب مراجعة — أُنشئ طلب مراجعة جودة وأعيد تقييم الجاهزية`, `${r.events.length} event(s) require review — a quality review was created and readiness re-evaluated`), { action: { label: t("فتح", "Open"), onClick: () => (window.location.href = `/quality?review=${r.reviewId}`) } });
      else toast.success(t(`${r.readingsCount} قراءة — لم يُرصد تجاوز (وهذا لا يثبت سلامة المنتج)`, `${r.readingsCount} readings — no excursion observed (this does not prove product safety)`));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const reset = useMutation({ mutationFn: () => api.post(`/api/virtual-sensors/shipments/${shipmentId}/reset`), onSuccess: () => { setStreamId(null); qc.invalidateQueries({ queryKey: ["sensors"] }); toast.info(t("أُرشفت السلاسل النشطة — مراجعات الجودة لا تُحذف", "Active streams archived — quality reviews are kept")); } });

  const s = stream.data;
  const th = s?.thresholds ?? {};
  const data = (s?.readings ?? []).map((r: AnyRec) => ({ ts: new Date(r.ts).getTime(), label: f.time(r.ts), temperature: r.missing ? null : r.temperatureC, humidity: r.missing ? null : r.humidityPct, shock: r.missing ? null : r.shockG, vibration: r.missing ? null : r.vibrationRms }));
  const ship = shipments.data?.find((x) => x.id === shipmentId);
  const chart = (key: string, color: string, unit: string, lines: { y: number; label: string }[]) => (
    <div className="h-48" dir="ltr">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "#637487" }} interval={11} />
          <YAxis tick={{ fontSize: 10.5, fill: "#637487" }} unit={unit} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
          {s?.events.filter((e: AnyRec) => (key === "temperature" && e.type === "TEMP_EXCURSION") || (key === "shock" && e.type === "SHOCK") || e.type === "MISSING_DATA").map((e: AnyRec) => <ReferenceArea key={e.id} x1={f.time(e.startedAt)} x2={f.time(e.endedAt)} fill={e.type === "MISSING_DATA" ? "#94a3b8" : "#b42318"} fillOpacity={0.12} />)}
          {lines.map((l) => <ReferenceLine key={l.label} y={l.y} stroke="#b42318" strokeDasharray="4 4" label={{ value: l.label, fontSize: 10, fill: "#b42318", position: "insideTopRight" }} />)}
          <Line dataKey={key} stroke={color} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <>
      <PageHeader title={t("محرك الحساسات الافتراضية", "Virtual sensor engine")} description={t("حساسات برمجية 100% بتوليد عشوائي ذي بذرة قابل لإعادة الإنتاج. تُخزن القراءات كسلسلة زمنية، وتُطبق قواعد عتبات لاكتشاف الأحداث، وأي حدث يتطلب مراجعة يُنشئ طلب جودة ويحدّث الجاهزية ومتطلبات التخصيص.", "100% software sensors with seeded, reproducible generation. Readings are stored as a time series, threshold rules detect events, and any reviewable event creates a quality requirement and updates readiness and assignment requirements.")} badges={<SyntheticBadge kind="synthetic" />} />
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("أدوات الاختبار", "Test controls")} />
            <CardBody className="space-y-4">
              <Field label={t("الشحنة", "Shipment")} htmlFor="sh"><Select id="sh" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)}><option value="">{t("اختر شحنة…", "Select a shipment…")}</option>{shipments.data?.filter((x) => !["DEPARTED", "CANCELLED"].includes(x.truckStatus)).map((x) => <option key={x.id} value={x.id}>{x.reference} · {x.truckCode ?? "—"} · {label("cargo", x.cargoType, locale)}</option>)}</Select></Field>
              <Field label={t("البذرة (اختيارية — للتكرار المطابق)", "Seed (optional — for identical repeats)")} htmlFor="seed"><Input id="seed" type="number" dir="ltr" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder={t("عشوائية", "random")} /></Field>
              {can("sensors:generate") ? (
                <div className="grid gap-2">
                  <Button variant="outline" disabled={!shipmentId} loading={gen.isPending && gen.variables === "NORMAL"} onClick={() => gen.mutate("NORMAL")}><CheckCircle2 />{t("توليد رحلة اعتيادية", "Generate normal journey")}</Button>
                  <Button variant="outline" disabled={!shipmentId} loading={gen.isPending && gen.variables === "TEMP_EXCURSION"} onClick={() => gen.mutate("TEMP_EXCURSION")}><Thermometer />{t("توليد تجاوز حراري", "Generate temperature excursion")}</Button>
                  <Button variant="outline" disabled={!shipmentId} loading={gen.isPending && gen.variables === "SHOCK"} onClick={() => gen.mutate("SHOCK")}><Zap />{t("توليد حدث صدمة", "Generate shock event")}</Button>
                  <Button variant="outline" disabled={!shipmentId} loading={gen.isPending && gen.variables === "MISSING_DATA"} onClick={() => gen.mutate("MISSING_DATA")}><WifiOff />{t("توليد بيانات مفقودة", "Generate missing data")}</Button>
                  <Button variant="ghost" disabled={!shipmentId} onClick={() => reset.mutate()}><RotateCcw />{t("إعادة ضبط السيناريو", "Reset scenario")}</Button>
                </div>
              ) : <p className="text-[12px] text-muted">{t("لا تملك صلاحية توليد السيناريوهات", "You cannot generate scenarios")}</p>}
            </CardBody>
          </Card>
          {ship ? (
            <Card>
              <CardHeader title={ship.reference} subtitle={ship.truckCode} />
              <CardBody className="space-y-2 text-[12.5px]">
                <p>{t("الحمولة", "Cargo")}: {label("cargo", ship.cargoType, locale)}</p>
                <p>{t("الجودة", "Quality")}: <StatusBadge group="quality" value={ship.qualityStatus} /></p>
                <p>{t("فحص مطلوب", "Inspection required")}: {ship.inspectionRequired ? t("نعم", "Yes") : t("لا", "No")}</p>
                {ship.truckId ? <Link href={`/readiness?truck=${ship.truckId}`} className="inline-block font-medium text-teal-700 hover:underline">{t("أثر ذلك على الجاهزية", "Effect on readiness")} →</Link> : null}
              </CardBody>
            </Card>
          ) : null}
          {streams.data?.length ? (
            <Card>
              <CardHeader title={t("السلاسل المولدة", "Generated streams")} />
              <ul className="divide-y divide-line-2">{streams.data.map((x) => <li key={x.id}><button onClick={() => setStreamId(x.id)} className={`w-full px-4 py-2.5 text-start text-[12px] hover:bg-canvas ${current === x.id ? "bg-teal-50/60" : ""}`}><span className="font-medium">{label("sensorScenario", x.scenario, locale)}</span>{x.isActive ? <Badge tone="teal" className="ms-1.5">{t("نشطة", "active")}</Badge> : null}<p className="num text-muted">seed {x.seed} · {f.dateTime(x.createdAt)}</p></button></li>)}</ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {!shipmentId ? <Card><EmptyState icon={<Thermometer className="size-5" />} title={t("اختر شحنة لعرض أو توليد قراءات الحساس", "Select a shipment to view or generate sensor readings")} /></Card> : !current ? <Card><EmptyState title={t("لا توجد قراءات لهذه الشحنة بعد", "No readings for this shipment yet")} /></Card> : stream.isLoading ? <Card><LoadingBlock rows={8} /></Card> : s ? (
            <>
              <Card>
                <CardHeader title={t("الخط الزمني للحساس", "Sensor timeline")} subtitle={<span className="num">{label("sensorScenario", s.scenario, locale)} · seed {s.seed} · {s.generatorVersion} · {s.readings.length} {t("قراءة كل 5 دقائق", "readings every 5 min")}</span>} actions={<SyntheticBadge kind="synthetic" />} />
                <CardBody className="space-y-5">
                  <div><p className="mb-1 text-[12px] font-semibold text-navy-800">{t("درجة الحرارة (°م)", "Temperature (°C)")}</p>{chart("temperature", "#0b2e52", "°", [...(th.tempMaxC !== undefined ? [{ y: th.tempMaxC, label: `max ${th.tempMaxC}` }] : []), ...(th.tempMinC !== undefined ? [{ y: th.tempMinC, label: `min ${th.tempMinC}` }] : [])])}</div>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <div><p className="mb-1 text-[12px] font-semibold text-navy-800">{t("الصدمة (g)", "Shock (g)")}</p>{chart("shock", "#c08a2c", "g", th.shockMaxG !== undefined ? [{ y: th.shockMaxG, label: `max ${th.shockMaxG}` }] : [])}</div>
                    <div><p className="mb-1 text-[12px] font-semibold text-navy-800">{t("الرطوبة (%)", "Humidity (%)")}</p>{chart("humidity", "#18bdb5", "%", th.humidityMaxPct !== undefined ? [{ y: th.humidityMaxPct, label: `max ${th.humidityMaxPct}` }] : [])}</div>
                  </div>
                  <div><p className="mb-1 text-[12px] font-semibold text-navy-800">{t("الاهتزاز (RMS)", "Vibration (RMS)")}</p>{chart("vibration", "#1d5584", "", [])}</div>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title={t("الأحداث المكتشفة بقواعد العتبات", "Events detected by threshold rules")} />
                {s.events.length ? (
                  <Table>
                    <thead><tr><Th>{t("القاعدة", "Rule")}</Th><Th>{t("الحدث", "Event")}</Th><Th>{t("الفترة", "Window")}</Th><Th>{t("الذروة / الحد", "Peak / limit")}</Th><Th>{t("القراءات", "Readings")}</Th><Th>{t("الخطورة", "Severity")}</Th><Th>{t("يتطلب مراجعة", "Review")}</Th></tr></thead>
                    <tbody>{s.events.map((e: AnyRec) => <tr key={e.id}><Td className="num">{e.ruleId}</Td><Td>{label("sensorEvent", e.type, locale)}</Td><Td className="num">{f.time(e.startedAt)}–{f.time(e.endedAt)}</Td><Td className="num">{e.peakValue ?? "—"} / {e.threshold ?? "—"}</Td><Td className="num">{e.readingsCount}</Td><Td><StatusBadge group="severity" value={e.severity} /></Td><Td>{e.requiresReview ? <Badge tone="warn">{t("نعم", "Yes")}</Badge> : t("لا", "No")}</Td></tr>)}</tbody>
                  </Table>
                ) : <EmptyState title={t("لم يُرصد تجاوز", "No excursion observed")} description={t("عدم وجود تجاوز في السجل لا يعني إثبات سلامة المنتج.", "Absence of an excursion in the record does not prove product safety.")} />}
                <p className="px-5 py-3 text-[11.5px] text-muted">{t("القواعد: R-TEMP-01 قراءتان متتاليتان خارج النطاق (≥10 د) · R-HUM-01 ثلاث قراءات فوق الحد · R-SHOCK-01 أي قراءة فوق حد الصدمة · R-MISS-01 ثلاث قراءات مفقودة متتالية (≥15 د).", "Rules: R-TEMP-01 two consecutive out-of-range readings (≥10 min) · R-HUM-01 three readings above max · R-SHOCK-01 any reading above the shock limit · R-MISS-01 three consecutive missing readings (≥15 min).")}</p>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

export default function SensorsPage() {
  return (
    <Suspense>
      <SensorsInner />
    </Suspense>
  );
}
