"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Plus, Save, Search } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { toast } from "sonner";
import { CARGO_TYPES, PRIORITIES, TRUCK_STATUSES } from "@wasl/shared";
import { api, qs } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan } from "@/lib/session";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingBlock, PageHeader, Select, StatusBadge, SyntheticBadge, inputCls } from "@/components/ui";
import { TruckLink, type AnyRec } from "@/components/domain";
import { TruckCreateDialog } from "@/components/truck-form";
import { cn } from "@/lib/utils";

const VIEWS_KEY = "wasl.trucks.views";
type View = { name: string; filters: Record<string, string>; columns: VisibilityState };
const SORTABLE: Record<string, string> = { code: "code", planned: "plannedArrival", requested: "requestedArrival", status: "status", priority: "priority" };
const BULK = ["MARK_ARRIVAL", "CANCEL", "MARK_NO_SHOW"] as const;

function TrucksInner() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Record<string, string>>({ q: sp.get("q") ?? "", status: sp.get("status") ?? "", cargoType: "", priority: "", carrierId: "" });
  const [sorting, setSorting] = useState<SortingState>([{ id: "planned", desc: false }]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [visibility, setVisibility] = useState<VisibilityState>({ requested: false, estimate: true });
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [bulk, setBulk] = useState<(typeof BULK)[number] | null>(null);
  const [views, setViews] = useState<View[]>([]);
  const [debouncedQ, setDebouncedQ] = useState(filters.q);

  useEffect(() => {
    try {
      setViews(JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]"));
    } catch {
      setViews([]);
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => clearTimeout(id);
  }, [filters.q]);
  useEffect(() => setPage(1), [debouncedQ, filters.status, filters.cargoType, filters.priority, filters.carrierId]);

  const params = { q: debouncedQ, status: filters.status, cargoType: filters.cargoType, priority: filters.priority, carrierId: filters.carrierId, page, pageSize, sort: SORTABLE[sorting[0]?.id ?? "planned"] ?? "plannedArrival", dir: sorting[0]?.desc ? "desc" : "asc" };
  const q = useQuery({ queryKey: ["trucks", params], queryFn: () => api.get<{ items: AnyRec[]; total: number }>(`/api/trucks${qs(params)}`), placeholderData: keepPreviousData });
  const carriers = useQuery({ queryKey: ["carriers"], queryFn: () => api.get<AnyRec[]>("/api/carriers") });

  const columns = useMemo<ColumnDef<AnyRec>[]>(
    () => [
      { id: "select", enableHiding: false, header: ({ table }) => <input type="checkbox" aria-label={t("تحديد الكل", "Select all")} className="size-4" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} />, cell: ({ row }) => <input type="checkbox" aria-label={t("تحديد", "Select")} className="size-4" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} /> },
      { id: "code", header: t("الشاحنة", "Truck"), enableHiding: false, cell: ({ row }) => <div><TruckLink id={row.original.id} code={row.original.code} /><div className="num text-[11px] text-muted">{row.original.plateNumber}</div></div> },
      { id: "carrier", header: t("الناقل", "Carrier"), cell: ({ row }) => <span className="text-ink-2">{locale === "ar" ? row.original.carrier.nameAr : row.original.carrier.name}</span> },
      { id: "cargo", header: t("الشحنة", "Shipment"), cell: ({ row }) => <div><span>{label("cargo", row.original.shipment.cargoType, locale)}</span> <span className="num text-[11px] text-muted">· {row.original.shipment.palletCount} {t("طبلية", "plt")}</span>{row.original.shipment.qualityStatus !== "NO_ISSUE_OBSERVED" ? <div><StatusBadge group="quality" value={row.original.shipment.qualityStatus} /></div> : null}</div> },
      { id: "vehicle", header: t("المركبة", "Vehicle"), cell: ({ row }) => label("vehicle", row.original.vehicleType, locale) },
      { id: "requested", header: t("الموعد المطلوب", "Requested"), cell: ({ row }) => <span className="num">{f.dateTime(row.original.requestedArrival)}</span> },
      { id: "planned", header: t("الموعد المؤكد", "Confirmed"), cell: ({ row }) => (row.original.appointment?.confirmedStart ? <span className="num">{f.dateTime(row.original.appointment.confirmedStart)}</span> : <span className="text-[12px] text-muted">{t("غير مؤكد", "Not confirmed")}</span>) },
      { id: "arrival", header: t("الوصول الفعلي", "Actual arrival"), cell: ({ row }) => <span className="num">{f.time(row.original.actualArrival)}</span> },
      { id: "dock", header: t("الرصيف", "Dock"), cell: ({ row }) => <span className="num">{row.original.dock?.code ?? "—"}{row.original.reassignmentRequired ? <Badge tone="bad" className="ms-1">{t("إعادة تخصيص", "Reassign")}</Badge> : null}</span> },
      { id: "estimate", header: t("مدة الخدمة المقدرة", "Service estimate"), cell: ({ row }) => <span title={row.original.serviceEstimateSource}><span className="num">{row.original.serviceEstimateMin}</span> {t("د", "min")} <span className="text-[10.5px] text-muted">{String(row.original.serviceEstimateSource).split(":")[0]}</span></span> },
      { id: "priority", header: t("الأولوية", "Priority"), cell: ({ row }) => <StatusBadge group="priority" value={row.original.priority} /> },
      { id: "status", header: t("الحالة", "Status"), enableHiding: false, cell: ({ row }) => <StatusBadge group="truckStatus" value={row.original.status} /> },
    ],
    [t, locale, f],
  );

  const table = useReactTable({
    data: q.data?.items ?? [],
    columns,
    getRowId: (r) => r.id,
    state: { sorting, columnVisibility: visibility, rowSelection: selection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: setSelection,
    manualSorting: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const bulkMut = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason: string }) => api.post<AnyRec>("/api/trucks/bulk-transitions", { action, truckIds: Object.keys(selection), reason: reason || null }),
    onSuccess: (r) => {
      toast[r.failed ? "warning" : "success"](t(`نجح ${r.succeeded} وفشل ${r.failed} (كل شاحنة تُتحقق على الخادم)`, `${r.succeeded} succeeded, ${r.failed} failed (each truck validated server-side)`), { description: r.results.filter((x: AnyRec) => !x.ok).map((x: AnyRec) => x.error).slice(0, 3).join(" · ") });
      setSelection({});
      setBulk(null);
      qc.invalidateQueries({ queryKey: ["trucks"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function saveView() {
    const name = window.prompt(t("اسم العرض المحفوظ", "Saved view name"));
    if (!name) return;
    const next = [...views.filter((v) => v.name !== name), { name, filters, columns: visibility }];
    setViews(next);
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: view kept for this session only */
    }
    toast.success(t("تم حفظ العرض على هذا المتصفح", "View saved in this browser"));
  }

  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const selected = Object.keys(selection).length;

  return (
    <>
      <PageHeader
        title={t("الشاحنات", "Trucks")}
        description={t("سجل الشاحنات والشحنات مع حالة دورة الحياة. جميع الانتقالات تخضع لآلة حالات وصلاحيات يتحقق منها الخادم.", "Truck & shipment register with lifecycle state. Every transition is enforced by a server-side state machine and permissions.")}
        badges={<SyntheticBadge kind="demo" />}
        actions={
          <>
            <Button variant="outline" onClick={() => (window.location.href = `/api/trucks/export.csv${qs({ ...params, page: 1, pageSize: 200 })}`)}><Download />CSV</Button>
            {can("trucks:create") ? <Button onClick={() => setCreateOpen(true)}><Plus />{t("تسجيل شاحنة", "Register truck")}</Button> : null}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-2 p-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input className={cn(inputCls, "ps-8")} placeholder={t("بحث بالرمز أو اللوحة أو الشحنة أو الناقل", "Search code, plate, shipment, carrier")} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} aria-label={t("بحث", "Search")} />
          </div>
          <Select className="w-auto" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label={t("الحالة", "Status")}>
            <option value="">{t("كل الحالات", "All statuses")}</option>
            {TRUCK_STATUSES.map((s) => <option key={s} value={s}>{label("truckStatus", s, locale)}</option>)}
          </Select>
          <Select className="w-auto" value={filters.cargoType} onChange={(e) => setFilters({ ...filters, cargoType: e.target.value })} aria-label={t("الحمولة", "Cargo")}>
            <option value="">{t("كل الحمولات", "All cargo")}</option>
            {CARGO_TYPES.map((s) => <option key={s} value={s}>{label("cargo", s, locale)}</option>)}
          </Select>
          <Select className="w-auto" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} aria-label={t("الأولوية", "Priority")}>
            <option value="">{t("كل الأولويات", "All priorities")}</option>
            {PRIORITIES.map((s) => <option key={s} value={s}>{label("priority", s, locale)}</option>)}
          </Select>
          {(carriers.data?.length ?? 0) > 1 ? (
            <Select className="w-auto" value={filters.carrierId} onChange={(e) => setFilters({ ...filters, carrierId: e.target.value })} aria-label={t("الناقل", "Carrier")}>
              <option value="">{t("كل الناقلين", "All carriers")}</option>
              {carriers.data!.map((c) => <option key={c.id} value={c.id}>{locale === "ar" ? c.nameAr : c.name}</option>)}
            </Select>
          ) : null}
          <div className="ms-auto flex items-center gap-2">
            {views.length ? (
              <Select className="w-auto" value="" onChange={(e) => { const v = views.find((x) => x.name === e.target.value); if (v) { setFilters(v.filters); setVisibility(v.columns); } }} aria-label={t("العروض المحفوظة", "Saved views")}>
                <option value="">{t("العروض المحفوظة", "Saved views")}</option>
                {views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </Select>
            ) : null}
            <Button variant="outline" size="sm" onClick={saveView}><Save />{t("حفظ العرض", "Save view")}</Button>
            <Popover.Root>
              <Popover.Trigger asChild><Button variant="outline" size="sm"><Columns3 />{t("الأعمدة", "Columns")}</Button></Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={6} className="z-50 w-56 rounded-xl border border-line bg-surface p-2 shadow-xl">
                  {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
                    <label key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-canvas">
                      <input type="checkbox" className="size-4" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                      {String(c.columnDef.header)}
                    </label>
                  ))}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>
        {selected > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line-2 bg-teal-50/60 px-4 py-2 text-[12.5px]">
            <span className="font-medium text-teal-700">{t(`${selected} محددة`, `${selected} selected`)}</span>
            {can("trucks:transition") ? BULK.map((a) => <Button key={a} size="sm" variant={a === "MARK_ARRIVAL" ? "outline" : "dangerOutline"} onClick={() => setBulk(a)}>{label("truckAction", a, locale)}</Button>) : <span className="text-muted">{t("لا تملك صلاحية الإجراءات الجماعية", "You lack permission for bulk actions")}</span>}
            <Button size="sm" variant="ghost" onClick={() => setSelection({})}>{t("إلغاء التحديد", "Clear")}</Button>
          </div>
        ) : null}
        {q.isLoading ? <LoadingBlock rows={8} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : total === 0 ? (
          <EmptyState title={t("لا توجد شاحنات مطابقة", "No matching trucks")} description={t("غيّر عوامل التصفية أو سجّل شاحنة جديدة.", "Adjust the filters or register a new truck.")} action={can("trucks:create") ? <Button onClick={() => setCreateOpen(true)}><Plus />{t("تسجيل شاحنة", "Register truck")}</Button> : undefined} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const sortable = !!SORTABLE[h.column.id];
                      const s = sorting[0]?.id === h.column.id ? (sorting[0].desc ? "desc" : "asc") : null;
                      return (
                        <th key={h.id} aria-sort={s === "asc" ? "ascending" : s === "desc" ? "descending" : undefined} className="whitespace-nowrap border-b border-line bg-canvas/70 px-4 py-2.5 text-start text-[11.5px] font-semibold text-muted">
                          {sortable ? (
                            <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSorting([{ id: h.column.id, desc: s === "asc" }])}>
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {s === "asc" ? <ArrowUp className="size-3" /> : s === "desc" ? <ArrowDown className="size-3" /> : null}
                            </button>
                          ) : flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className={cn(q.isFetching && "opacity-70")}>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className={cn("cursor-pointer hover:bg-canvas/60", row.getIsSelected() && "bg-teal-50/40")} onClick={() => router.push(`/trucks/${row.original.id}`)}>
                    {row.getVisibleCells().map((c) => <td key={c.id} className="border-b border-line-2 px-4 py-2.5 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12.5px] text-muted">
          <span>{t(`${total} شاحنة · صفحة ${page} من ${pages}`, `${total} trucks · page ${page} of ${pages}`)}</span>
          <div className="flex items-center gap-2">
            <Select className="h-8 w-auto" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label={t("حجم الصفحة", "Page size")}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t("السابق", "Previous")}><ChevronRight className="rtl:rotate-0 ltr:rotate-180" /></Button>
            <Button variant="outline" size="icon" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label={t("التالي", "Next")}><ChevronLeft className="rtl:rotate-0 ltr:rotate-180" /></Button>
          </div>
        </div>
      </Card>
      <TruckCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(tr) => router.push(`/trucks/${tr.id}`)} />
      <ConfirmDialog
        open={!!bulk}
        onOpenChange={(o) => !o && setBulk(null)}
        title={bulk ? t(`${label("truckAction", bulk, locale)} — ${selected} شاحنة`, `${label("truckAction", bulk, locale)} — ${selected} trucks`) : ""}
        description={t("يُطبَّق الإجراء على كل شاحنة بشكل مستقل ويُرفض لأي شاحنة لا تسمح حالتها بذلك.", "The action is applied to each truck independently and rejected where the truck's state does not allow it.")}
        confirmLabel={t("تنفيذ", "Apply")}
        tone={bulk === "MARK_ARRIVAL" ? "primary" : "danger"}
        requireReason={bulk !== "MARK_ARRIVAL"}
        loading={bulkMut.isPending}
        onConfirm={(reason) => bulk && bulkMut.mutate({ action: bulk, reason })}
      />
    </>
  );
}

export default function TrucksPage() {
  return (
    <Suspense>
      <TrucksInner />
    </Suspense>
  );
}
