"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { ROLE_PERMISSIONS, type Role } from "@wasl/shared";
import { api } from "@/lib/api";
import { useFormat, useLocale, useT } from "@/lib/i18n";
import { label } from "@/lib/labels";
import { useCan, useSession } from "@/lib/session";
import { Badge, Button, Card, CardHeader, Dialog, ErrorState, Field, Input, LoadingBlock, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import type { AnyRec } from "@/components/domain";

export default function UsersPage() {
  const t = useT();
  const locale = useLocale();
  const f = useFormat();
  const can = useCan();
  const session = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["users"], queryFn: () => api.get<AnyRec>("/api/users") });
  const carriers = useQuery({ queryKey: ["carriers"], queryFn: () => api.get<AnyRec[]>("/api/carriers") });
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ email: "", name: "", password: "", role: "AUDITOR", carrierId: "" });
  const create = useMutation({ mutationFn: () => api.post("/api/users", { ...v, carrierId: v.carrierId || null }), onSuccess: () => { toast.success(t("أُنشئ المستخدم", "User created")); setOpen(false); setV({ email: "", name: "", password: "", role: "AUDITOR", carrierId: "" }); qc.invalidateQueries({ queryKey: ["users"] }); }, onError: (e) => toast.error((e as Error).message) });
  const role = useMutation({ mutationFn: ({ id, r }: { id: string; r: string }) => api.patch(`/api/users/${id}/role`, { role: r }), onSuccess: () => { toast.success(t("تم تغيير الدور وأُنهيت جلسات المستخدم", "Role changed; user sessions revoked")); qc.invalidateQueries({ queryKey: ["users"] }); }, onError: (e) => toast.error((e as Error).message) });
  if (q.isLoading) return <Card><LoadingBlock rows={8} /></Card>;
  if (q.error) return <Card><ErrorState error={q.error} /></Card>;
  const assignable: Role[] = q.data!.assignableRoles;
  return (
    <>
      <PageHeader title={t("إدارة المستخدمين", "User management")} description={t("مستخدمو المنظمة وأدوارهم. الصلاحيات تُفرض في الخادم لكل طلب؛ أدوار الناقل والسائق مقيدة بسجلات شركتهم فقط. حسابات التجربة المزروعة محمية من التعديل في وضع التجربة.", "Organisation users and roles. Permissions are enforced server-side on every request; carrier and driver roles are scoped to their own company's records. Seeded demo accounts are protected in demo mode.")} actions={can("users:manage") && assignable.length ? <Button onClick={() => setOpen(true)}><UserPlus />{t("مستخدم جديد", "New user")}</Button> : null} />
      <Card>
        <Table>
          <thead><tr><Th>{t("المستخدم", "User")}</Th><Th>{t("الدور", "Role")}</Th><Th>{t("النطاق", "Scope")}</Th><Th>{t("الصلاحيات", "Permissions")}</Th><Th>{t("آخر دخول", "Last login")}</Th><Th /></tr></thead>
          <tbody>{q.data!.users.map((u: AnyRec) => (
            <tr key={u.id}>
              <Td><p className="font-medium">{u.name}{u.isDemo ? <Badge tone="teal" className="ms-1.5">{t("تجريبي", "demo")}</Badge> : null}</p><p className="num text-[11.5px] text-muted">{u.email}</p></Td>
              <Td>{label("role", u.role, locale)}</Td>
              <Td className="text-[12px]">{u.carrierName ?? t("المنظمة كاملة", "Whole organisation")}</Td>
              <Td className="num text-[12px]">{ROLE_PERMISSIONS[u.role as Role].length}</Td>
              <Td className="num text-[12px] text-muted">{f.dateTime(u.lastLoginAt)}</Td>
              <Td>{can("users:manage") && u.id !== session.user.id && assignable.includes(u.role) && !u.isDemo ? <Select className="h-8 w-auto text-[12px]" value={u.role} onChange={(e) => role.mutate({ id: u.id, r: e.target.value })} aria-label={t("تغيير الدور", "Change role")}>{assignable.map((r) => <option key={r} value={r}>{label("role", r, locale)}</option>)}</Select> : null}</Td>
            </tr>
          ))}</tbody>
        </Table>
      </Card>
      <Card className="mt-4">
        <CardHeader title={t("مصفوفة الأدوار والصلاحيات", "Role & permission matrix")} subtitle={t("المصدر: packages/shared/src/permissions.ts — نفس الجدول الذي يطبقه الخادم", "Source: packages/shared/src/permissions.ts — the same table the server enforces")} />
        <Table>
          <thead><tr><Th>{t("الدور", "Role")}</Th><Th>{t("الصلاحيات", "Permissions")}</Th></tr></thead>
          <tbody>{(Object.keys(ROLE_PERMISSIONS) as Role[]).map((r) => <tr key={r}><Td className="whitespace-nowrap font-medium">{label("role", r, locale)}</Td><Td><div className="flex flex-wrap gap-1">{ROLE_PERMISSIONS[r].map((p) => <code key={p} className="rounded bg-line-2 px-1.5 py-0.5 text-[10.5px]">{p}</code>)}</div></Td></tr>)}</tbody>
        </Table>
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title={t("إنشاء مستخدم", "Create user")} footer={<><Button variant="outline" onClick={() => setOpen(false)}>{t("إلغاء", "Cancel")}</Button><Button loading={create.isPending} disabled={!v.email || v.name.length < 2 || v.password.length < 12} onClick={() => create.mutate()}>{t("إنشاء", "Create")}</Button></>}>
        <div className="grid gap-4">
          <Field label={t("الاسم", "Name")} htmlFor="u-n"><Input id="u-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label={t("البريد", "Email")} htmlFor="u-e"><Input id="u-e" type="email" dir="ltr" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <Field label={t("كلمة المرور (12 حرفًا على الأقل)", "Password (min. 12 characters)")} htmlFor="u-p"><Input id="u-p" type="password" dir="ltr" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></Field>
          <Field label={t("الدور", "Role")} htmlFor="u-r"><Select id="u-r" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{assignable.map((r) => <option key={r} value={r}>{label("role", r, locale)}</option>)}</Select></Field>
          {v.role === "CARRIER_OPERATOR" || v.role === "DRIVER" ? <Field label={t("الناقل", "Carrier")} htmlFor="u-c"><Select id="u-c" value={v.carrierId} onChange={(e) => setV({ ...v, carrierId: e.target.value })}><option value="">—</option>{carriers.data?.map((c) => <option key={c.id} value={c.id}>{locale === "ar" ? c.nameAr : c.name}</option>)}</Select></Field> : null}
        </div>
      </Dialog>
    </>
  );
}
