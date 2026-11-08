"use client";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Lock } from "lucide-react";
import { EVENT_TYPES } from "@wasl/shared";
import { api, qs } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Input, KeyValue, LoadingBlock, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { eventLabel, type AnyRec } from "@/components/domain";

export default function EventsPage() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const [flt, setFlt] = useState({ q: "", eventType: "", entityType: "", source: "" });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<AnyRec | null>(null);
  const params = { ...flt, page, pageSize: 50 };
  const q = useQuery({ queryKey: ["events", "list", params], queryFn: () => api.get<AnyRec>(`/api/events${qs(params)}`), placeholderData: keepPreviousData });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 50));
  return (
    <>
      <PageHeader title={t("سجل الأحداث", "Event timeline")} description={t("سجل تدقيق إلحاقي فقط: يرفض مشغّل في قاعدة البيانات أي تعديل أو حذف للأحداث التاريخية. لكل حدث معرّف ونوع وكيان وفاعل ومصدر ومعرّف ارتباط والحالة السابقة والجديدة.", "Append-only audit log: a database trigger rejects any update or deletion of historical events. Each event has an ID, type, entity, actor, source, correlation ID and previous/new state.")} badges={<Badge tone="navy"><Lock className="size-3" />{t("غير قابل للتعديل", "Immutable")}</Badge>} actions={<><Button variant="outline" onClick={() => (window.location.href = `/api/events/export${qs({ ...flt, format: "csv" })}`)}><Download />CSV</Button><Button variant="outline" onClick={() => (window.location.href = `/api/events/export${qs({ ...flt, format: "json" })}`)}><Download />JSON</Button></>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line-2 p-3">
          <Input className="w-64" placeholder={t("بحث بالكيان أو الفاعل أو النوع", "Search entity, actor, type")} value={flt.q} onChange={(e) => { setFlt({ ...flt, q: e.target.value }); setPage(1); }} aria-label={t("بحث", "Search")} />
          <Select className="w-auto" value={flt.eventType} onChange={(e) => { setFlt({ ...flt, eventType: e.target.value }); setPage(1); }} aria-label={t("نوع الحدث", "Event type")}><option value="">{t("كل الأنواع", "All types")}</option>{EVENT_TYPES.map((x) => <option key={x} value={x}>{eventLabel(x, locale)}</option>)}</Select>
          <Select className="w-auto" value={flt.entityType} onChange={(e) => { setFlt({ ...flt, entityType: e.target.value }); setPage(1); }} aria-label={t("الكيان", "Entity")}><option value="">{t("كل الكيانات", "All entities")}</option>{["truck", "dock", "team", "equipment", "shipment", "quality_review", "handover", "optimization_run", "simulation_scenario", "user", "facility"].map((x) => <option key={x} value={x}>{x}</option>)}</Select>
          <Select className="w-auto" value={flt.source} onChange={(e) => { setFlt({ ...flt, source: e.target.value }); setPage(1); }} aria-label={t("المصدر", "Source")}><option value="">{t("كل المصادر", "All sources")}</option>{["USER", "SYSTEM", "READINESS_ENGINE", "OPTIMIZER", "SIMULATOR", "SENSOR_ENGINE", "SEED"].map((x) => <option key={x} value={x}>{x}</option>)}</Select>
        </div>
        {q.isLoading ? <LoadingBlock rows={10} /> : q.error ? <ErrorState error={q.error} /> : !q.data?.items.length ? <EmptyState title={t("لا أحداث مطابقة", "No matching events")} /> : (
          <Table>
            <thead><tr><Th>{t("الوقت", "Time")}</Th><Th>{t("الحدث", "Event")}</Th><Th>{t("الكيان", "Entity")}</Th><Th>{t("الفاعل", "Actor")}</Th><Th>{t("المصدر", "Source")}</Th><Th>{t("الحالة", "State")}</Th></tr></thead>
            <tbody>{q.data!.items.map((e: AnyRec) => <tr key={e.id} className="cursor-pointer hover:bg-canvas/60" onClick={() => setSel(e)}><Td className="num whitespace-nowrap">{f.dateTime(e.occurredAt)}</Td><Td><span className="font-medium">{eventLabel(e.eventType, locale)}</span><p className="text-[10.5px] text-muted">{e.eventType}</p></Td><Td><span className="num font-medium text-navy-700">{e.entityLabel ?? "—"}</span><p className="text-[10.5px] text-muted">{e.entityType}</p></Td><Td className="text-[12px]">{e.actorLabel}</Td><Td><Badge tone="neutral">{e.source}</Badge></Td><Td className="num text-[12px]">{e.newState?.status ? `${e.previousState?.status ?? "∅"} → ${e.newState.status}` : "—"}</Td></tr>)}</tbody>
          </Table>
        )}
        <div className="flex items-center justify-between px-4 py-3 text-[12.5px] text-muted"><span>{t(`${q.data?.total ?? 0} حدث`, `${q.data?.total ?? 0} events`)}</span><div className="flex gap-2"><Button size="icon" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t("السابق", "Previous")}><ChevronRight className="ltr:rotate-180" /></Button><Button size="icon" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label={t("التالي", "Next")}><ChevronLeft className="ltr:rotate-180" /></Button></div></div>
      </Card>
      <Drawer open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={sel ? eventLabel(sel.eventType, locale) : ""} subtitle={sel?.eventType}>
        {sel ? (
          <div className="space-y-4">
            <KeyValue items={[{ k: "Event ID", v: <span className="num text-[11px]">{sel.id}</span> }, { k: t("الوقت", "Timestamp"), v: <span className="num">{new Date(sel.occurredAt).toISOString()}</span> }, { k: t("الكيان", "Entity"), v: `${sel.entityType} · ${sel.entityLabel ?? ""}` }, { k: "Entity ID", v: <span className="num text-[11px]">{sel.entityId}</span> }, { k: t("الفاعل", "Actor"), v: sel.actorLabel }, { k: t("المصدر", "Source"), v: sel.source }, { k: "Correlation ID", v: <span className="num text-[11px]">{sel.correlationId}</span> }, { k: "Seq", v: <span className="num">{sel.seq}</span> }]} />
            {[["previousState", t("الحالة السابقة", "Previous state")], ["newState", t("الحالة الجديدة", "New state")], ["payload", "Payload"]].map(([k, l]) => <div key={k}><p className="mb-1 text-[12px] font-semibold text-navy-800">{l}</p><pre className="num scroll-thin max-h-60 overflow-auto rounded-lg bg-navy-950 p-3 text-start text-[11px] leading-relaxed text-[#cfe6f3]" dir="ltr">{JSON.stringify(sel[k], null, 2)}</pre></div>)}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
