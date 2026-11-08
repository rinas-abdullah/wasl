"use client";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CARGO_TYPES, HANDLING_METHODS, PRIORITIES, VEHICLE_TYPES } from "@wasl/shared";
import { api, newIdempotencyKey } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { Button, Dialog, Field, Input, Select, Textarea } from "./ui";
import type { AnyRec } from "./domain";

const formSchema = z
  .object({
    plateNumber: z.string().trim().min(3).max(20),
    carrierId: z.string().uuid(),
    driverId: z.string().optional(),
    vehicleType: z.enum(VEHICLE_TYPES),
    priority: z.enum(PRIORITIES),
    requestedArrival: z.string().min(1),
    notes: z.string().max(1000).optional(),
    cargoType: z.enum(CARGO_TYPES),
    palletCount: z.coerce.number().int().min(1).max(60),
    weightKg: z.coerce.number().int().min(1).max(40000),
    handlingMethod: z.enum(HANDLING_METHODS),
    documentsComplete: z.boolean(),
    inspectionRequired: z.boolean(),
    tempMinC: z.string().optional(),
    tempMaxC: z.string().optional(),
  })
  .refine((v) => new Date(v.requestedArrival).getTime() > Date.now() - 10 * 60_000, { path: ["requestedArrival"], message: "past" })
  .refine((v) => !v.tempMinC || !v.tempMaxC || Number(v.tempMinC) < Number(v.tempMaxC), { path: ["tempMaxC"], message: "range" });
type FormIn = z.input<typeof formSchema>;
type FormOut = z.output<typeof formSchema>;

function localInputValue(d: Date) {
  // datetime-local in the user's browser zone (facility zone in the demo context)
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function TruckCreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (t: AnyRec) => void }) {
  const t = useT();
  const locale = useLocale();
  const session = useSession();
  const qc = useQueryClient();
  const carriers = useQuery({ queryKey: ["carriers"], queryFn: () => api.get<AnyRec[]>("/api/carriers"), enabled: open });
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(formSchema),
    defaultValues: { plateNumber: "", carrierId: session.carrierId ?? "", driverId: "", vehicleType: "ARTICULATED", priority: "NORMAL", requestedArrival: localInputValue(new Date(Date.now() + 3 * 3600_000)), notes: "", cargoType: "GENERAL", palletCount: 18, weightKg: 9000, handlingMethod: "FORKLIFT_PALLET", documentsComplete: true, inspectionRequired: false, tempMinC: "", tempMaxC: "" },
  });
  const { register, handleSubmit, formState, control, reset, setValue } = form;
  const carrierId = useWatch({ control, name: "carrierId" });
  const cargo = useWatch({ control, name: "cargoType" });
  const drivers = carriers.data?.find((c) => c.id === carrierId)?.drivers ?? [];

  useEffect(() => {
    if (open) reset(undefined, { keepDefaultValues: true });
  }, [open, reset]);
  useEffect(() => {
    if (cargo === "CHILLED" || cargo === "PHARMA") {
      setValue("tempMinC", "2");
      setValue("tempMaxC", "8");
      setValue("vehicleType", "REEFER_TRAILER");
    } else if (cargo === "FROZEN") {
      setValue("tempMinC", "-25");
      setValue("tempMaxC", "-15");
      setValue("vehicleType", "REEFER_TRAILER");
    }
  }, [cargo, setValue]);

  // Unsaved changes warning
  useEffect(() => {
    if (!open || !formState.isDirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [open, formState.isDirty]);

  const create = useMutation({
    mutationFn: (v: FormOut) => {
      const rc: Record<string, number> = {};
      if (v.tempMinC) rc.tempMinC = Number(v.tempMinC);
      if (v.tempMaxC) rc.tempMaxC = Number(v.tempMaxC);
      return api.post<AnyRec>(
        "/api/trucks",
        {
          plateNumber: v.plateNumber,
          carrierId: v.carrierId,
          driverId: v.driverId || null,
          vehicleType: v.vehicleType,
          priority: v.priority,
          requestedArrival: new Date(v.requestedArrival).toISOString(),
          notes: v.notes || null,
          shipment: { cargoType: v.cargoType, palletCount: v.palletCount, weightKg: v.weightKg, handlingMethod: v.handlingMethod, documentsComplete: v.documentsComplete, inspectionRequired: v.inspectionRequired, requiredConditions: rc },
        },
        { idempotencyKey: newIdempotencyKey() },
      );
    },
    onSuccess: (truck) => {
      toast.success(t(`تم تسجيل ${truck.code} — مدة الخدمة المقدرة ${truck.serviceEstimateMin} دقيقة (${truck.serviceEstimateSource})`, `${truck.code} registered — estimated service ${truck.serviceEstimateMin} min (${truck.serviceEstimateSource})`));
      qc.invalidateQueries({ queryKey: ["trucks"] });
      reset();
      onOpenChange(false);
      onCreated?.(truck);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const err = (k: keyof FormIn) => (formState.errors[k] ? t("قيمة غير صالحة", "Invalid value") : null);
  const close = (o: boolean) => {
    if (!o && formState.isDirty && !window.confirm(t("لديك تغييرات غير محفوظة. إغلاق النموذج؟", "You have unsaved changes. Close the form?"))) return;
    onOpenChange(o);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      wide
      title={t("تسجيل شاحنة وشحنة", "Register truck & shipment")}
      description={t("تُقدَّر مدة الخدمة تلقائيًا بنموذج تجريبي (أو بخط أساس معلن إذا لم يتوفر). يُنشأ طلب موعد بحالة «مطلوب» ويُؤكَّد من صفحة المواعيد أو من محرك التحسين.", "Service time is estimated automatically by an experimental model (or a declared baseline if unavailable). A REQUESTED appointment is created and confirmed from the schedule or the optimiser.")}
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)}>{t("إلغاء", "Cancel")}</Button>
          <Button onClick={handleSubmit((v) => create.mutate(v))} loading={create.isPending}>{t("تسجيل", "Register")}</Button>
        </>
      }
    >
      <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
        <p className="text-[12px] font-semibold text-navy-800 md:col-span-2">{t("الشاحنة", "Truck")}</p>
        <Field label={t("رقم اللوحة (تجريبي)", "Plate number (demo)")} htmlFor="plate" error={err("plateNumber")}><Input id="plate" dir="ltr" {...register("plateNumber")} aria-invalid={!!formState.errors.plateNumber} /></Field>
        <Field label={t("الناقل", "Carrier")} htmlFor="carrier" error={err("carrierId")}>
          <Select id="carrier" {...register("carrierId")} disabled={session.role === "CARRIER_OPERATOR"}>
            <option value="">{t("اختر…", "Select…")}</option>
            {carriers.data?.map((c) => <option key={c.id} value={c.id}>{locale === "ar" ? c.nameAr : c.name}</option>)}
          </Select>
        </Field>
        <Field label={t("مرجع السائق", "Driver reference")} htmlFor="driver">
          <Select id="driver" {...register("driverId")}>
            <option value="">—</option>
            {drivers.map((d: AnyRec) => <option key={d.id} value={d.id}>{d.reference} · {d.displayName}</option>)}
          </Select>
        </Field>
        <Field label={t("نوع المركبة", "Vehicle type")} htmlFor="veh"><Select id="veh" {...register("vehicleType")}>{VEHICLE_TYPES.map((v) => <option key={v} value={v}>{label("vehicle", v, locale)}</option>)}</Select></Field>
        <Field label={t("الوصول المطلوب", "Requested arrival")} htmlFor="arr" error={formState.errors.requestedArrival ? t("يجب أن يكون في المستقبل", "Must be in the future") : null} hint={t("بتوقيت جهازك", "In your device time zone")}><Input id="arr" type="datetime-local" dir="ltr" {...register("requestedArrival")} /></Field>
        <Field label={t("الأولوية", "Priority")} htmlFor="prio"><Select id="prio" {...register("priority")}>{PRIORITIES.map((v) => <option key={v} value={v}>{label("priority", v, locale)}</option>)}</Select></Field>

        <p className="mt-2 text-[12px] font-semibold text-navy-800 md:col-span-2">{t("متطلبات الشحنة", "Shipment requirements")}</p>
        <Field label={t("نوع الحمولة", "Cargo type")} htmlFor="cargo"><Select id="cargo" {...register("cargoType")}>{CARGO_TYPES.map((v) => <option key={v} value={v}>{label("cargo", v, locale)}</option>)}</Select></Field>
        <Field label={t("طريقة المناولة", "Handling method")} htmlFor="hand"><Select id="hand" {...register("handlingMethod")}>{HANDLING_METHODS.map((v) => <option key={v} value={v}>{label("handling", v, locale)}</option>)}</Select></Field>
        <Field label={t("عدد الطبليات", "Pallets")} htmlFor="pal" error={err("palletCount")}><Input id="pal" type="number" dir="ltr" {...register("palletCount")} /></Field>
        <Field label={t("الوزن (كجم)", "Weight (kg)")} htmlFor="wt" error={err("weightKg")}><Input id="wt" type="number" dir="ltr" {...register("weightKg")} /></Field>
        <Field label={t("أدنى حرارة (°م)", "Min temperature (°C)")} htmlFor="tmin"><Input id="tmin" type="number" dir="ltr" {...register("tempMinC")} /></Field>
        <Field label={t("أعلى حرارة (°م)", "Max temperature (°C)")} htmlFor="tmax" error={formState.errors.tempMaxC ? t("يجب أن تكون أعلى من الحد الأدنى", "Must exceed the minimum") : null}><Input id="tmax" type="number" dir="ltr" {...register("tempMaxC")} /></Field>
        <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" className="size-4 accent-[var(--color-teal-600)]" {...register("documentsComplete")} />{t("المستندات مكتملة", "Documents complete")}</label>
        <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" className="size-4 accent-[var(--color-teal-600)]" {...register("inspectionRequired")} />{t("يتطلب فحص جودة (إلزامي تلقائيًا للأدوية)", "Requires quality inspection (automatic for pharma)")}</label>
        <Field label={t("ملاحظات", "Notes")} htmlFor="notes" className="md:col-span-2"><Textarea id="notes" {...register("notes")} /></Field>
      </form>
    </Dialog>
  );
}
