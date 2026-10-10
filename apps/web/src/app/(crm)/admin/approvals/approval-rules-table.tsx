"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { CheckboxListField, SwitchField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { approvalRuleInputSchema, type ApprovalRule } from "@flow/shared/approvals";
import { useSubmit } from "../users/user-dialogs";
import { updateApprovalRuleAction } from "../../approvals/actions";
import { messageKey } from "../../approvals/message-key";

type RoleOption = { id: string; name: string };

/** One row per action: whether it needs approval, who approves, and when it is overdue. */
export function ApprovalRulesTable({ rules, roles }: { rules: ApprovalRule[]; roles: RoleOption[] }) {
  const t = useTranslations("approvalRules");
  const ta = useTranslations("approvals");
  const [editing, setEditing] = useState<ApprovalRule | null>(null);

  const columns: DataTableColumn<ApprovalRule>[] = [
    { id: "action", header: t("fields.action"), cell: ({ row }) => <span className="font-medium">{ta(`actions.${messageKey(row.original.action)}`)}</span> },
    {
      id: "required",
      header: t("fields.required"),
      cell: ({ row }) => <Badge variant={row.original.required ? "default" : "secondary"}>{row.original.required ? t("on") : t("off")}</Badge>,
    },
    { id: "approvers", header: t("fields.approvers"), cell: ({ row }) => row.original.approvers.map((role) => role.name).join(", ") || "—" },
    { id: "overdueHours", header: t("fields.overdueHours"), cell: ({ row }) => t("hours", { hours: row.original.overdueHours }) },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)} aria-label={t("editLabel", { name: ta(`actions.${messageKey(row.original.action)}`) })}>
          <PencilIcon />
          {t("edit")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={rules} label={t("title")} empty={null} getRowId={(row) => row.action} />
      {editing && <RuleDialog rule={editing} roles={roles} onClose={() => setEditing(null)} />}
    </>
  );
}

type RuleValues = { required: boolean; approverRoleIds: string[]; overdueHours: string };

function RuleDialog({ rule, roles, onClose }: { rule: ApprovalRule; roles: RoleOption[]; onClose: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<RuleValues>({
    resolver: zodResolver(approvalRuleInputSchema, undefined, { raw: true }) as never,
    defaultValues: { required: rule.required, approverRoleIds: rule.approvers.map((role) => role.id), overdueHours: String(rule.overdueHours) },
  });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => updateApprovalRuleAction(rule.action, values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("approvalRules.saved"));
        onClose();
        router.refresh();
      },
    ),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t(`approvals.actions.${messageKey(rule.action)}`)}</DialogTitle>
            <DialogDescription>{t("approvalRules.editDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <SwitchField control={form.control} name="required" label={t("approvalRules.fields.required")} />
            <CheckboxListField
              control={form.control}
              name="approverRoleIds"
              label={t("approvalRules.fields.approvers")}
              description={t("approvalRules.approversHint")}
              options={roles.map((role) => ({ value: role.id, label: role.name }))}
            />
            <TextField control={form.control} name="overdueHours" label={t("approvalRules.fields.overdueHours")} inputMode="numeric" />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
