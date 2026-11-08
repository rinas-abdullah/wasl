"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { History, Pause, Play, Radio, SkipBack } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { Badge, Button, Card, CardBody, CardHeader, Drawer, EmptyState, ErrorState, KeyValue, LoadingBlock, PageHeader, Select, StatusBadge, SyntheticBadge, Tabs } from "@/components/ui";
import { EventTimeline, OutcomeBanner, eventLabel, type AnyRec } from "@/components/domain";
import { cn } from "@/lib/utils";

const W = 1200;
const H = 640;
const BUILDING = { x: 160, y: 30, w: 880, h: 190 };
const TRUCK_COLORS: Record<string, string> = { SCHEDULED: "#64748b", REGISTERED: "#94a3b8", CALLED: "#0ea69f", ARRIVED: "#0ea69f", WAITING: "#c08a2c", IN_SERVICE: "#15803d", COMPLETED: "#1d5584", DEPARTED: "#94a3b8", EXCEPTION: "#b42318" };
const DOCK_COLORS: Record<string, string> = { AVAILABLE: "#15803d", OCCUPIED: "#1d5584", RESERVED: "#0ea69f", OUT_OF_SERVICE: "#b42318", MAINTENANCE: "#c08a2c" };

function zoneOf(status: string, arrived: boolean, qualityOpen = false) {
  if (status === "DEPARTED") return "EXITED";
  if (status === "IN_SERVICE" || status === "COMPLETED") return "DOCK";
  if (status === "ARRIVED" || (status === "CALLED" && arrived)) return "TO_DOCK";
  if (status === "WAITING" || status === "EXCEPTION") return qualityOpen ? "QUALITY" : "YARD";
  if (status === "CALLED") return "APPROACH";
  if (status === "CANCELLED" || status === "NO_SHOW") return "GONE";
  return "PLANNED";
}

interface TwinTruck { id: string; code: string; status: string; zone: string; dockId: string | null; meta?: AnyRec }
interface TwinDock { id: string; code: string; status: string; position: number; meta?: AnyRec }

export default function TwinPage() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [sel, setSel] = useState<{ kind: "dock" | "truck"; id: string } | null>(null);
  const live = useQuery({ queryKey: ["twin", "state"], queryFn: () => api.get<AnyRec>("/api/twin/state") });

  // ---------------- replay ----------------
  const [range, setRange] = useState(() => ({ from: new Date(Date.now() - 6 * 3600_000).toISOString(), to: new Date().toISOString() }));
  const replay = useQuery({ queryKey: ["twin", "replay", range], queryFn: () => api.get<AnyRec>(`/api/twin/replay${qs(range)}`), enabled: mode === "replay" });
  const [cursor, setCursor] = useState(0); // ms offset from range.from
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(120);
  const span = new Date(range.to).getTime() - new Date(range.from).getTime();
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setCursor((c) => {
        const n = c + dt * speed;
        if (n >= span) {
          setPlaying(false);
          return span;
        }
        return n;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, speed, span]);

  const liveData = live.data;
  const metaById = useMemo(() => Object.fromEntries((liveData?.trucks ?? []).map((x: AnyRec) => [x.id, x])), [liveData]);

  const view = useMemo((): { docks: TwinDock[]; trucks: TwinTruck[]; at: Date | null; recent: AnyRec[] } | null => {
    if (!liveData) return null;
    if (mode === "live") {
      return {
        at: null,
        recent: [],
        docks: liveData.docks.map((d: AnyRec) => ({ id: d.id, code: d.code, status: d.status, position: d.position, meta: d })),
        trucks: liveData.trucks.map((x: AnyRec) => ({ id: x.id, code: x.code, status: x.status, zone: x.zone, dockId: x.dockId, meta: x })),
      };
    }
    if (!replay.data) return null;
    const at = new Date(new Date(range.from).getTime() + cursor);
    const state: Record<string, { entityType: string; label: string | null; state: AnyRec }> = JSON.parse(JSON.stringify(replay.data.initial));
    const recent: AnyRec[] = [];
    for (const e of replay.data.events as AnyRec[]) {
      if (new Date(e.occurredAt) > at) break;
      state[e.entityId] = { entityType: e.entityType, label: e.entityLabel, state: { ...(state[e.entityId]?.state ?? {}), ...e.newState } };
      recent.push(e);
    }
    const docks = liveData.docks.map((d: AnyRec) => ({ id: d.id, code: d.code, position: d.position, status: (state[d.id]?.state.status as string) === "OUT_OF_SERVICE" || state[d.id]?.state.status === "MAINTENANCE" ? String(state[d.id].state.status) : "AVAILABLE", meta: d }));
    const trucks: TwinTruck[] = Object.entries(state)
      .filter(([, v]) => v.entityType === "truck")
      .map(([id, v]) => {
        const st = String(v.state.status ?? "REGISTERED");
        return { id, code: v.label ?? id.slice(0, 6), status: st, dockId: (v.state.assignedDockId as string) ?? metaById[id]?.dockId ?? null, zone: zoneOf(st, !!v.state.actualArrival), meta: metaById[id] };
      })
      .filter((x) => x.zone !== "GONE");
    for (const d of docks) if (trucks.some((x) => x.dockId === d.id && x.status === "IN_SERVICE") && d.status === "AVAILABLE") d.status = "OCCUPIED";
    return { docks, trucks, at, recent: recent.slice(-12).reverse() };
  }, [liveData, mode, replay.data, cursor, range.from, metaById]);

  if (live.isLoading) return <Card><LoadingBlock rows={10} /></Card>;
  if (live.error) return <Card><ErrorState error={live.error} onRetry={() => live.refetch()} /></Card>;
  const v = view;
  const nDocks = Math.max(1, liveData!.docks.length);
  const dockSlot = BUILDING.w / nDocks;
  const dockX = (pos: number) => BUILDING.x + dockSlot * (pos - 1) + dockSlot / 2;
  const yardCap = liveData!.facility.yardCapacity as number;
  const yardCols = Math.ceil(yardCap / 2);

  // position trucks
  const placed: { tr: TwinTruck; x: number; y: number; rot: number }[] = [];
  if (v) {
    const byZone = (z: string) => v.trucks.filter((x) => x.zone === z);
    for (const tr of byZone("DOCK")) {
      const d = v.docks.find((dd) => dd.id === tr.dockId);
      if (d) placed.push({ tr, x: dockX(d.position), y: BUILDING.y + BUILDING.h + 62, rot: 90 });
    }
    byZone("TO_DOCK").forEach((tr, i) => {
      const d = v.docks.find((dd) => dd.id === tr.dockId);
      placed.push({ tr, x: d ? dockX(d.position) : 600, y: BUILDING.y + BUILDING.h + 150 + (i % 2) * 6, rot: 90 });
    });
    byZone("YARD").forEach((tr, i) => placed.push({ tr, x: 230 + (i % yardCols) * 92, y: 470 + Math.floor(i / yardCols) * 62, rot: 0 }));
    byZone("QUALITY").forEach((tr, i) => placed.push({ tr, x: 1110, y: 300 + i * 52, rot: 0 }));
    byZone("APPROACH").forEach((tr, i) => placed.push({ tr, x: 70 + i * 0, y: 470 + i * 46, rot: 0 }));
    byZone("PLANNED").slice(0, 6).forEach((tr, i) => placed.push({ tr, x: 230 + i * 120, y: 612, rot: 0 }));
    byZone("EXITED").slice(0, 4).forEach((tr, i) => placed.push({ tr, x: 1130, y: 470 + i * 40, rot: 0 }));
  }
  const yardCount = v?.trucks.filter((x) => x.zone === "YARD" || x.zone === "QUALITY").length ?? 0;

  const selDock = sel?.kind === "dock" ? liveData!.docks.find((d: AnyRec) => d.id === sel.id) : null;
  const selTruck = sel?.kind === "truck" ? sel.id : null;

  return (
    <>
      <PageHeader
        title={t("التوأم الرقمي التشغيلي", "Operational digital twin")}
        description={t("تمثيل تفاعلي لمركز التوزيع مرتبط بحالة النظام المخزنة في الخادم، ويتحدث فوريًا عبر Server-Sent Events عند تغير الأرصفة أو الشاحنات أو الجودة. وضع الإعادة يعيد بناء الحالة من سجل الأحداث.", "Interactive model of the distribution center bound to server-side state, updated instantly via Server-Sent Events when docks, trucks or quality change. Replay mode rebuilds state from the event log.")}
        badges={<SyntheticBadge kind="demo" />}
        actions={<Tabs value={mode} onValueChange={(m) => { setMode(m as "live" | "replay"); setPlaying(false); setCursor(0); }} items={[{ value: "live", label: <span className="flex items-center gap-1.5"><Radio className="size-3.5" />{t("مباشر", "Live")}</span> }, { value: "replay", label: <span className="flex items-center gap-1.5"><History className="size-3.5" />{t("إعادة تشغيل السجل", "Replay log")}</span> }]} />}
      />

      {mode === "replay" ? (
        <Card className="mb-4 border-warn/40">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Badge tone="warn">{t("وضع الإعادة — حالة تاريخية وليست الحالة الحالية", "REPLAY — historical state, not current")}</Badge>
            <Button size="icon" variant="outline" onClick={() => { setCursor(0); setPlaying(false); }} aria-label={t("إلى البداية", "To start")}><SkipBack /></Button>
            <Button size="icon" variant={playing ? "outline" : "primary"} onClick={() => setPlaying((p) => !p)} aria-label={playing ? t("إيقاف مؤقت", "Pause") : t("تشغيل", "Play")} disabled={!replay.data}>{playing ? <Pause /> : <Play />}</Button>
            <Select className="h-9 w-auto" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label={t("سرعة التشغيل", "Playback speed")}>
              {[30, 120, 600, 1800].map((s) => <option key={s} value={s}>{s}×</option>)}
            </Select>
            <input type="range" min={0} max={span} step={1000} value={cursor} onChange={(e) => setCursor(Number(e.target.value))} className="min-w-[200px] flex-1 accent-[var(--color-teal-600)]" aria-label={t("الخط الزمني", "Timeline")} dir="ltr" />
            <span className="num text-[13px] font-semibold">{v?.at ? f.dateTime(v.at) : "—"}</span>
            <Select className="h-9 w-auto" value={String(Math.round(span / 3600_000))} onChange={(e) => { setRange({ from: new Date(Date.now() - Number(e.target.value) * 3600_000).toISOString(), to: new Date().toISOString() }); setCursor(0); }} aria-label={t("النطاق", "Range")}>
              {[2, 6, 12, 24].map((h) => <option key={h} value={h}>{t(`آخر ${h} ساعات`, `Last ${h} h`)}</option>)}
            </Select>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="relative bg-[#f3f6f9]" dir="ltr">
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={t("مخطط مركز التوزيع", "Distribution center map")}>
              <defs>
                <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#e2e8ee" strokeWidth="0.6" /></pattern>
                <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#b42318" strokeWidth="2" opacity="0.35" /></pattern>
              </defs>
              <rect width={W} height={H} fill="url(#grid)" />
              {/* road + lanes */}
              <rect x="0" y="590" width={W} height="44" fill="#dde5ec" />
              <line x1="0" y1="612" x2={W} y2="612" stroke="#fff" strokeWidth="2" strokeDasharray="14 12" />
              <rect x="20" y="300" width="100" height="290" fill="#e6ecf1" rx="6" />
              <rect x={BUILDING.x} y={BUILDING.y + BUILDING.h + 105} width={BUILDING.w} height="80" fill="#e8edf2" rx="4" />
              <text x={BUILDING.x + 10} y={BUILDING.y + BUILDING.h + 120} fontSize="11" fill="#637487">{t("ممر داخلي إلى الأرصفة", "Internal lane to docks")}</text>
              {/* building */}
              <rect x={BUILDING.x} y={BUILDING.y} width={BUILDING.w} height={BUILDING.h} rx="10" fill="#fff" stroke="#c9d6e3" strokeWidth="2" />
              <text x={BUILDING.x + 16} y={BUILDING.y + 26} fontSize="14" fontWeight="600" fill="#0b2e52">{locale === "ar" ? liveData!.facility.nameAr : liveData!.facility.name}</text>
              <text x={BUILDING.x + 16} y={BUILDING.y + 44} fontSize="11" fill="#637487">{t("المستودع — منطقة الاستلام", "Warehouse — receiving area")}</text>
              {/* resource zone: teams */}
              {liveData!.teams.map((tm: AnyRec, i: number) => (
                <g key={tm.id} transform={`translate(${BUILDING.x + 16 + i * 150}, ${BUILDING.y + 62})`}>
                  <rect width="138" height="40" rx="8" fill={tm.status === "AVAILABLE" ? "#eaf9f7" : "#fdecea"} stroke={tm.status === "AVAILABLE" ? "#18bdb5" : "#b42318"} strokeOpacity="0.4" />
                  <text x="10" y="17" fontSize="11.5" fontWeight="600" fill="#142538">{locale === "ar" ? tm.nameAr : tm.name}</text>
                  <text x="10" y="31" fontSize="10" fill="#637487">{tm.size} · {tm.shiftStart}–{tm.shiftEnd}</text>
                </g>
              ))}
              {liveData!.equipment.map((e: AnyRec, i: number) => (
                <g key={e.id} transform={`translate(${BUILDING.x + 16 + i * 66}, ${BUILDING.y + 112})`}>
                  <rect width="58" height="22" rx="5" fill={e.status === "AVAILABLE" ? "#f6f8fa" : "#fdf5e3"} stroke="#c9d6e3" />
                  <text x="29" y="15" fontSize="10" textAnchor="middle" fill={e.status === "AVAILABLE" ? "#45586c" : "#a16207"}>{e.code}</text>
                </g>
              ))}
              {/* quality zone */}
              <rect x="1060" y="250" width="120" height="200" rx="8" fill="#fdf5e3" stroke="#c08a2c" strokeOpacity="0.5" strokeDasharray="5 4" />
              <text x="1120" y="270" fontSize="11" fontWeight="600" textAnchor="middle" fill="#a16207">{t("منطقة فحص الجودة", "Quality inspection")}</text>
              {/* yard */}
              <rect x="180" y="430" width={yardCols * 92 + 10} height="140" rx="8" fill="#fff" stroke="#c9d6e3" strokeDasharray="6 4" />
              <text x="190" y="447" fontSize="11" fontWeight="600" fill="#45586c">{t(`الساحة / منطقة الانتظار (${yardCount}/${yardCap})`, `Yard / waiting area (${yardCount}/${yardCap})`)}</text>
              {Array.from({ length: yardCap }).map((_, i) => <rect key={i} x={194 + (i % yardCols) * 92} y={455 + Math.floor(i / yardCols) * 62} width="76" height="34" rx="4" fill="none" stroke="#e2e8ee" />)}
              {/* gates */}
              {liveData!.gates.map((g: AnyRec) => {
                const x = g.type === "ENTRY" ? 70 : 1130;
                return (
                  <g key={g.id}>
                    <rect x={x - 34} y="574" width="68" height="16" rx="3" fill={g.status === "OPEN" ? "#0b2e52" : "#b42318"} />
                    <text x={x} y="586" fontSize="10" textAnchor="middle" fill="#fff">{g.code} · {g.type === "ENTRY" ? t("دخول", "Entry") : t("خروج", "Exit")}</text>
                  </g>
                );
              })}
              <text x="70" y="292" fontSize="10.5" textAnchor="middle" fill="#637487">{t("في الطريق (مُستدعاة)", "En route (called)")}</text>
              <text x="230" y="604" fontSize="10" fill="#637487">{t("قادمة ضمن الخطة ←", "Planned upcoming →")}</text>
              {/* docks */}
              {v?.docks.map((d) => {
                const x = dockX(d.position);
                const down = d.status === "OUT_OF_SERVICE" || d.status === "MAINTENANCE";
                return (
                  <g key={d.id} className="cursor-pointer" onClick={() => setSel({ kind: "dock", id: d.id })} role="button" aria-label={`${d.code} ${d.status}`}>
                    <rect x={x - 54} y={BUILDING.y + BUILDING.h - 6} width="108" height="22" rx="4" fill={DOCK_COLORS[d.status] ?? "#94a3b8"} />
                    <text x={x} y={BUILDING.y + BUILDING.h + 9} fontSize="12" fontWeight="700" textAnchor="middle" fill="#fff">{d.code} · {label("dockStatus", d.status, locale)}</text>
                    <rect x={x - 54} y={BUILDING.y + BUILDING.h + 18} width="108" height="76" fill={down ? "url(#hatch)" : "#fff"} stroke={DOCK_COLORS[d.status] ?? "#94a3b8"} strokeOpacity="0.5" strokeDasharray={down ? "0" : "4 3"} rx="3" />
                  </g>
                );
              })}
              {/* trucks */}
              {placed.map(({ tr, x, y }) => {
                const qOpen = tr.meta && ["REVIEW_REQUIRED", "UNDER_REVIEW", "HOLD", "ESCALATED"].includes(tr.meta.qualityStatus);
                return (
                  <g key={tr.id} style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform 900ms cubic-bezier(.2,.8,.2,1)" }} className="cursor-pointer" onClick={() => setSel({ kind: "truck", id: tr.id })} role="button" aria-label={`${tr.code} ${tr.status}`}>
                    <rect x="-36" y="-14" width="72" height="28" rx="6" fill={TRUCK_COLORS[tr.status] ?? "#64748b"} stroke={sel?.id === tr.id ? "#082b4c" : "#fff"} strokeWidth={sel?.id === tr.id ? 3 : 1.5} />
                    <rect x="22" y="-10" width="10" height="20" rx="2" fill="#fff" opacity="0.35" />
                    <text x="-6" y="4" fontSize="10.5" fontWeight="700" textAnchor="middle" fill="#fff">{tr.code.replace("WSL-", "")}</text>
                    {qOpen ? <circle cx="32" cy="-14" r="6" fill="#c08a2c" stroke="#fff" strokeWidth="1.5" /> : null}
                    {tr.meta?.reassignmentRequired ? <circle cx="-32" cy="-14" r="6" fill="#b42318" stroke="#fff" strokeWidth="1.5" /> : null}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line-2 px-4 py-2.5 text-[11.5px] text-muted">
            {Object.entries(TRUCK_COLORS).filter(([k]) => !["REGISTERED", "DEPARTED"].includes(k)).map(([k, c]) => <span key={k} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: c }} />{label("truckStatus", k, locale)}</span>)}
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#c08a2c]" />{t("مراجعة جودة مفتوحة", "Open quality review")}</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-bad" />{t("إعادة تخصيص مطلوبة", "Reassignment required")}</span>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={mode === "live" ? t("الحالة الآن", "Current state") : t("أحداث حتى المؤشر", "Events up to cursor")} subtitle={mode === "live" ? <span className="num">{t("إصدار الحالة", "State version")} #{liveData!.stateVersion}</span> : undefined} />
            <CardBody className="scroll-thin max-h-[520px] overflow-y-auto">
              {mode === "live" ? (
                <ul className="space-y-2 text-[12.5px]">
                  {[["DOCK", t("عند الأرصفة", "At docks")], ["TO_DOCK", t("متجهة للرصيف", "Heading to dock")], ["YARD", t("في الساحة", "In yard")], ["QUALITY", t("فحص الجودة", "Quality zone")], ["APPROACH", t("في الطريق", "En route")], ["PLANNED", t("مخطط", "Planned")]].map(([z, l]) => {
                    const items = v?.trucks.filter((x) => x.zone === z) ?? [];
                    return (
                      <li key={z}>
                        <p className="flex justify-between font-medium text-ink"><span>{l}</span><span className="num text-muted">{items.length}</span></p>
                        <div className="mt-1 flex flex-wrap gap-1">{items.map((x) => <button key={x.id} onClick={() => setSel({ kind: "truck", id: x.id })} className="num rounded-md border border-line px-1.5 py-0.5 text-[11.5px] hover:border-teal-500">{x.code}</button>)}</div>
                      </li>
                    );
                  })}
                </ul>
              ) : replay.isLoading ? <LoadingBlock /> : v?.recent.length ? (
                <ul className="space-y-2">
                  {v.recent.map((e) => (
                    <li key={e.id}>
                      <button className="w-full rounded-lg px-2 py-1.5 text-start hover:bg-canvas" onClick={() => { setPlaying(false); setCursor(new Date(e.occurredAt).getTime() - new Date(range.from).getTime()); }}>
                        <p className="text-[12.5px] font-medium">{eventLabel(e.eventType, locale)} <span className="num text-navy-700">{e.entityLabel}</span></p>
                        <p className="num text-[11px] text-muted">{f.time(e.occurredAt)} · {String(e.newState?.status ?? "")}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title={t("حرّك المؤشر أو اضغط تشغيل", "Move the cursor or press play")} />}
            </CardBody>
          </Card>
        </div>
      </div>

      <Drawer open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={selDock ? t(`الرصيف ${selDock.code}`, `Dock ${selDock.code}`) : t("تفاصيل الشاحنة", "Truck details")} subtitle={mode === "replay" ? t("البيانات التفصيلية تعرض الحالة الحالية", "Details show the current state") : undefined}>
        {selDock ? <DockPanel dock={selDock} teams={liveData!.teams} /> : selTruck ? <TruckPanel id={selTruck} /> : null}
      </Drawer>
    </>
  );
}

function DockPanel({ dock, teams }: { dock: AnyRec; teams: AnyRec[] }) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  return (
    <div className="space-y-5">
      <KeyValue items={[
        { k: t("المعرف", "Dock ID"), v: <span className="num">{dock.code}</span> },
        { k: t("الحالة", "Status"), v: <StatusBadge group="dockStatus" value={dock.status} /> },
        { k: t("الشاحنة المخصصة", "Assigned truck"), v: dock.currentTruck?.code ?? dock.assignedTrucks?.[0]?.code ?? "—" },
        { k: t("بدء الخدمة", "Service start"), v: <span className="num">{f.time(dock.currentTruck?.serviceStartedAt)}</span> },
        { k: t("الاكتمال المتوقع", "Estimated completion"), v: <span className="num">{f.time(dock.currentTruck?.estimatedCompletion)}</span> },
        { k: t("متاح تقديريًا", "Est. available"), v: <span className="num">{f.time(dock.estimatedAvailableAt)}</span> },
        { k: t("أقصى مركبة", "Max vehicle"), v: label("vehicle", dock.maxVehicleType, locale) },
        { k: t("متطلبات المعدات/المزايا", "Equipment / features"), v: dock.features.join(", ") || "—" },
      ]} />
      {dock.statusReason && dock.adminStatus !== "AVAILABLE" ? <p className="rounded-lg bg-bad-bg px-3 py-2 text-[12.5px] text-bad">{dock.statusReason}</p> : null}
      <div><p className="mb-1 text-[12px] font-semibold text-navy-800">{t("القيود التشغيلية", "Operational restrictions")}</p><p className="text-[12.5px] text-ink-2">{dock.restrictions ?? t("لا يوجد", "None")} · {t("الحمولات", "Cargo")}: {dock.compatibleCargo.map((c: string) => label("cargo", c, locale)).join("، ")}</p></div>
      <div><p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("القوى العاملة المتاحة", "Available workforce")}</p><div className="flex flex-wrap gap-1.5">{teams.filter((x) => x.status === "AVAILABLE").map((x) => <Badge key={x.id} tone="teal">{locale === "ar" ? x.nameAr : x.name} · {x.size}</Badge>)}</div></div>
      <div><p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("الشاحنات المخصصة", "Assigned trucks")}</p>{dock.assignedTrucks.length ? <ul className="space-y-1 text-[12.5px]">{dock.assignedTrucks.map((x: AnyRec) => <li key={x.id} className="flex items-center justify-between"><Link href={`/trucks/${x.id}`} className="num font-medium text-navy-700 hover:underline">{x.code}</Link><StatusBadge group="truckStatus" value={x.status} /></li>)}</ul> : <p className="text-[12px] text-muted">—</p>}</div>
      <Link href="/docks"><Button variant="outline" className="w-full">{t("إدارة الرصيف", "Manage dock")}</Button></Link>
    </div>
  );
}

function TruckPanel({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const q = useQuery({ queryKey: ["trucks", "detail", id], queryFn: () => api.get<AnyRec>(`/api/trucks/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorState error={q.error} />;
  const tr = q.data!;
  const appt = tr.appointments[0];
  return (
    <div className="space-y-5">
      <KeyValue items={[
        { k: t("الشاحنة", "Truck"), v: <Link href={`/trucks/${tr.id}`} className="num text-navy-700 hover:underline">{tr.code}</Link> },
        { k: t("الناقل", "Carrier"), v: locale === "ar" ? tr.carrier.nameAr : tr.carrier.name },
        { k: t("الموعد", "Appointment"), v: <span className="num">{f.dateTime(appt?.confirmedStart ?? appt?.requestedStart)}</span> },
        { k: t("نوع الشحنة", "Shipment type"), v: label("cargo", tr.shipment.cargoType, locale) },
        { k: t("الحالة الحالية", "Current state"), v: <StatusBadge group="truckStatus" value={tr.status} /> },
        { k: t("الرصيف المخصص", "Assigned dock"), v: tr.dock?.code ?? "—" },
        { k: t("مؤشرات الجودة", "Quality flags"), v: <StatusBadge group="quality" value={tr.shipment.qualityStatus} /> },
        { k: t("فحص مطلوب", "Inspection"), v: tr.shipment.inspectionRequired ? t("نعم", "Yes") : t("لا", "No") },
      ]} />
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-navy-800">{t("حالة الجاهزية", "Readiness status")}</p>
        {tr.latestEvaluation ? <OutcomeBanner outcome={tr.latestEvaluation.outcome} summary={tr.latestEvaluation.result?.summary} summaryAr={tr.latestEvaluation.result?.summaryAr} /> : <p className="text-[12px] text-muted">{t("لم يُقيّم", "Not evaluated")}</p>}
        <Link href={`/readiness?truck=${tr.id}`} className="mt-1.5 inline-block text-[12px] font-medium text-teal-700 hover:underline">{t("تقييم الآن", "Evaluate now")} →</Link>
      </div>
      <div><p className="mb-2 text-[12px] font-semibold text-navy-800">{t("سجل الأحداث", "Event history")}</p><EventTimeline events={tr.events.slice(0, 12)} compact /></div>
    </div>
  );
}

