"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, FlaskConical, Inbox, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";

/* ---------------- Button ---------------- */
const buttonV = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-navy-800 text-white hover:bg-navy-700",
        teal: "bg-teal-600 text-white hover:bg-teal-700",
        outline: "border border-line bg-surface text-ink hover:bg-canvas",
        ghost: "text-ink-2 hover:bg-line-2",
        danger: "bg-bad text-white hover:bg-[#912018]",
        dangerOutline: "border border-[#f3c3bd] bg-surface text-bad hover:bg-bad-bg",
      },
      size: { sm: "h-8 px-3", md: "h-9 px-4", lg: "h-11 px-5 text-sm", icon: "size-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonV> {
  loading?: boolean;
  /** When disabled, a reason shown as a tooltip (disabled states with reasons). */
  disabledReason?: string | null;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, disabledReason, disabled, children, ...props }, ref) => {
  const btn = (
    <button ref={ref} className={cn(buttonV({ variant, size }), className)} disabled={disabled || loading || !!disabledReason} aria-disabled={disabled || !!disabledReason} {...props}>
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  );
  if (disabledReason) return <Tip content={disabledReason}><span tabIndex={0} className="inline-flex">{btn}</span></Tip>;
  return btn;
});
Button.displayName = "Button";

/* ---------------- Tooltip ---------------- */
export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={6} className="z-[70] max-w-xs rounded-md bg-navy-950 px-2.5 py-1.5 text-xs leading-relaxed text-white shadow-lg">
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/* ---------------- Card ---------------- */
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...p} />;
}
export function CardHeader({ title, subtitle, actions, className }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-line-2 px-5 py-3.5", className)}>
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...p} />;
}

/* ---------------- Badge ---------------- */
export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "teal" | "navy";
const toneCls: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  info: "bg-info-bg text-info",
  neutral: "bg-line-2 text-ink-2",
  teal: "bg-teal-50 text-teal-700",
  navy: "bg-navy-800 text-white",
};
export function Badge({ tone = "neutral", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium", toneCls[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

const TONES: Record<string, Record<string, Tone>> = {
  truckStatus: { REGISTERED: "neutral", SCHEDULED: "info", CALLED: "teal", ARRIVED: "teal", WAITING: "warn", IN_SERVICE: "ok", COMPLETED: "ok", DEPARTED: "neutral", CANCELLED: "neutral", NO_SHOW: "bad", EXCEPTION: "bad" },
  dockStatus: { AVAILABLE: "ok", OCCUPIED: "info", RESERVED: "teal", OUT_OF_SERVICE: "bad", MAINTENANCE: "warn" },
  outcome: { READY: "ok", HOLD: "warn", REASSIGNMENT_REQUIRED: "bad", MANUAL_REVIEW_REQUIRED: "bad" },
  quality: { NO_ISSUE_OBSERVED: "neutral", REVIEW_REQUIRED: "warn", UNDER_REVIEW: "info", RELEASED_BY_AUTHORIZED_USER: "ok", ESCALATED: "bad", HOLD: "bad" },
  handover: { PENDING_ARRIVAL: "neutral", ARRIVAL_CONFIRMED: "info", UNLOADING: "teal", INSPECTION_RECORDED: "teal", APPROVED: "ok", CLOSED: "neutral" },
  priority: { LOW: "neutral", NORMAL: "neutral", HIGH: "warn", CRITICAL: "bad" },
  severity: { INFO: "info", LOW: "neutral", MEDIUM: "warn", HIGH: "bad", CRITICAL: "bad" },
  solver: { OPTIMAL: "ok", FEASIBLE: "teal", INFEASIBLE: "bad", MODEL_INVALID: "bad", UNKNOWN: "warn" },
  job: { QUEUED: "neutral", RUNNING: "info", COMPLETED: "ok", FAILED: "bad", CANCELLED: "neutral" },
  approval: { PENDING: "warn", APPROVED: "ok", REJECTED: "neutral", STALE: "neutral", NOT_APPLICABLE: "neutral" },
  decisionStatus: { PENDING_REVIEW: "warn", EXECUTED: "ok", REJECTED: "neutral", SUPERSEDED: "neutral", FAILED: "bad" },
  resource: { AVAILABLE: "ok", UNAVAILABLE: "bad", MAINTENANCE: "warn", OUT_OF_SERVICE: "bad" },
};

export function StatusBadge({ group, value, className }: { group: string; value: string | null | undefined; className?: string }) {
  const locale = useLocale();
  if (!value) return <span className="text-muted">—</span>;
  return (
    <Badge tone={TONES[group]?.[value] ?? "neutral"} dot className={className}>
      {label(group, value, locale)}
    </Badge>
  );
}

/** Explicit provenance label: required wherever synthetic data or model outputs are shown. */
export function SyntheticBadge({ kind = "synthetic" }: { kind?: "synthetic" | "simulation" | "model" | "demo" }) {
  const t = useT();
  const text = {
    synthetic: t("بيانات اصطناعية", "Synthetic data"),
    simulation: t("نتائج محاكاة محسوبة", "Computed simulation results"),
    model: t("نموذج تجريبي — بيانات تدريب اصطناعية", "Experimental model — synthetic training data"),
    demo: t("بيانات تجريبية", "Demo data"),
  }[kind];
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-teal-500/60 bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-700">
      <FlaskConical className="size-3" />
      {text}
    </span>
  );
}

/* ---------------- Form controls ---------------- */
export const inputCls = "h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-muted/70 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:bg-canvas aria-[invalid=true]:border-bad";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(inputCls, className)} {...p} />);
Input.displayName = "Input";
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(inputCls, "pe-8", className)} {...p} />);
Select.displayName = "Select";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(inputCls, "h-auto min-h-20 py-2", className)} {...p} />);
Textarea.displayName = "Textarea";

export function Field({ label: l, htmlFor, error, hint, children, className }: { label: React.ReactNode; htmlFor?: string; error?: string | null; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-2">
        {l}
      </label>
      {children}
      {error ? <p role="alert" className="text-xs text-bad">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/* ---------------- Dialog & Drawer ---------------- */
export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const t = useT();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy-950/40 backdrop-blur-[1px]" />
        <DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-surface shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}>
          <div className="flex items-start justify-between gap-4 border-b border-line-2 px-6 py-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 text-xs leading-relaxed text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{String(title)}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted hover:bg-line-2" aria-label={t("إغلاق", "Close")}>
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="scroll-thin overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-line-2 px-6 py-3.5">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Drawer({ open, onOpenChange, title, subtitle, children, actions }: { open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  const t = useT();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy-950/30" />
        <DialogPrimitive.Content className="fixed inset-y-0 end-0 z-50 flex w-full max-w-xl flex-col bg-surface shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-xs text-muted">{subtitle ?? ""}</DialogPrimitive.Description>
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <DialogPrimitive.Close className="rounded-md p-1 text-muted hover:bg-line-2" aria-label={t("إغلاق", "Close")}>
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Confirmation for destructive / consequential actions, with optional mandatory reason. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, tone = "primary", requireReason, reasonLabel, onConfirm, loading, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirmLabel: string; tone?: "primary" | "danger" | "teal"; requireReason?: boolean; reasonLabel?: string; onConfirm: (reason: string) => void; loading?: boolean; children?: React.ReactNode }) {
  const t = useT();
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (!open) setReason("");
  }, [open]);
  const invalid = requireReason && reason.trim().length < 3;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("إلغاء", "Cancel")}</Button>
          <Button variant={tone} loading={loading} disabled={invalid} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
        </>
      }
    >
      {children}
      {requireReason ? (
        <Field label={reasonLabel ?? t("السبب (إلزامي، يُسجل في سجل التدقيق)", "Reason (required, recorded in the audit log)")} htmlFor="confirm-reason" error={reason && invalid ? t("أدخل سببًا من 3 أحرف على الأقل", "Enter at least 3 characters") : null}>
          <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      ) : null}
    </Dialog>
  );
}

/* ---------------- Tabs ---------------- */
export function Tabs({ value, onValueChange, items, className }: { value: string; onValueChange: (v: string) => void; items: { value: string; label: React.ReactNode; count?: number }[]; className?: string }) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={className}>
      <TabsPrimitive.List className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
        {items.map((it) => (
          <TabsPrimitive.Trigger key={it.value} value={it.value} className="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium text-muted data-[state=active]:bg-navy-800 data-[state=active]:text-white">
            {it.label}
            {it.count !== undefined ? <span className="num rounded bg-black/10 px-1 text-[10.5px]">{it.count}</span> : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

/* ---------------- States ---------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-line-2", className)} />;
}
export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-5" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  );
}
export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-xl bg-line-2 text-muted">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-xl bg-bad-bg text-bad"><AlertTriangle className="size-5" /></div>
      <p className="text-sm font-medium text-ink">{t("تعذر تحميل البيانات", "Could not load data")}</p>
      <p className="mt-1 max-w-md text-xs text-muted">{msg}</p>
      {onRetry ? <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}><RefreshCw />{t("إعادة المحاولة", "Retry")}</Button> : null}
    </div>
  );
}

/* ---------------- Page header & KPI ---------------- */
export function PageHeader({ title, description, actions, badges }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; badges?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-navy-900">{title}</h1>
          {badges}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function KpiCard({ label: l, value, sub, icon, tone = "neutral", href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; tone?: Tone; href?: string }) {
  const iconTone: Record<Tone, string> = { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", info: "bg-info-bg text-info", neutral: "bg-line-2 text-ink-2", teal: "bg-teal-50 text-teal-700", navy: "bg-navy-800 text-white" };
  const inner = (
    <Card className={cn("flex h-full flex-col justify-between p-4", href && "transition-colors hover:border-teal-500/50")}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium leading-snug text-muted">{l}</span>
        {icon ? <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5", iconTone[tone])}>{icon}</span> : null}
      </div>
      <div className="mt-3">
        <div className="num text-start text-[26px] font-semibold leading-none tracking-tight text-navy-900">{value}</div>
        {sub ? <div className="mt-1.5 text-[11.5px] text-muted">{sub}</div> : null}
      </div>
    </Card>
  );
  return href ? <a href={href} className="block">{inner}</a> : inner;
}

export function KeyValue({ items, cols = 2 }: { items: { k: React.ReactNode; v: React.ReactNode }[]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-3")}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11.5px] text-muted">{it.k}</dt>
          <dd className="mt-0.5 truncate text-[13px] font-medium text-ink">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Simple table primitives ---------------- */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("scroll-thin overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => <th className={cn("whitespace-nowrap border-b border-line bg-canvas/70 px-4 py-2.5 text-start text-[11.5px] font-semibold text-muted", className)}>{children}</th>;
export const Td = ({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) => <td colSpan={colSpan} className={cn("border-b border-line-2 px-4 py-2.5 align-middle text-ink", className)}>{children}</td>;
