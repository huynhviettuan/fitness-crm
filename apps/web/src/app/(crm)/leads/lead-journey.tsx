"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTimeZone, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightLeftIcon, UserRoundCogIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { OptionSelect } from "@/components/option-select";
import { formatDateOnly, formatTime } from "@/lib/format";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import {
  leadAssignSchema,
  leadStatusChangeSchema,
  nextLeadStatuses,
  type Lead,
  type ManualLeadStatus,
} from "@flow/shared/leads";
import { useSubmit } from "../admin/users/user-dialogs";
import { assignLeadAction, changeLeadStatusAction } from "./actions";

type StatusValues = {
  status: ManualLeadStatus;
  appointmentDate: string;
  appointmentTime: string;
  refuseReasonId: string;
  refuseReasonNote: string;
  note: string;
};

/** Moves the lead along the fixed flow (D-020): only the moves allowed from its status are offered. */
export function ChangeStatusButton({ lead }: { lead: Lead }) {
  const t = useTranslations("leads");
  const [open, setOpen] = useState(false);
  if (nextLeadStatuses(lead.status).length === 0) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <ArrowRightLeftIcon />
        {t("changeStatus")}
      </Button>
      {open && <ChangeStatusDialog lead={lead} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangeStatusDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const timeZone = useTimeZone() ?? "Asia/Ho_Chi_Minh";
  const { pending, run } = useSubmit();
  const choices = nextLeadStatuses(lead.status);
  const form = useForm<StatusValues>({
    resolver: zodResolver(leadStatusChangeSchema, undefined, { raw: true }) as never,
    defaultValues: {
      status: choices[0],
      // Booking again starts from the current appointment.
      appointmentDate: lead.appointmentAt ? formatDateOnly(calendarDateInTimeZone(timeZone, lead.appointmentAt)) : "",
      appointmentTime: lead.appointmentAt ? formatTime(lead.appointmentAt, timeZone) : "",
      refuseReasonId: "",
      refuseReasonNote: "",
      note: "",
    },
  });
  const status = useWatch({ control: form.control, name: "status" });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => changeLeadStatusAction(lead.id, values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("leads.statusChanged"));
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
            <DialogTitle>{t("leads.changeStatusTitle", { name: lead.fullName })}</DialogTitle>
            <DialogDescription>{t("leads.changeStatusDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <SelectField
              control={form.control}
              name="status"
              label={t("leads.newStatus")}
              options={choices.map((value) => ({ value, label: t(`status.lead.${value}`) }))}
            />
            {status === "BOOKED" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={form.control}
                  name="appointmentDate"
                  label={t("leads.fields.appointmentDate")}
                  placeholder={t("leads.datePlaceholder")}
                  autoComplete="off"
                />
                <TextField
                  control={form.control}
                  name="appointmentTime"
                  label={t("leads.fields.appointmentTime")}
                  placeholder={t("leads.timePlaceholder")}
                  inputMode="numeric"
                />
              </div>
            )}
            {status === "REFUSED" && (
              <OptionSelect
                control={form.control}
                name="refuseReasonId"
                noteName="refuseReasonNote"
                listKey="leadRefuseReasons"
                label={t("leads.fields.refuseReason")}
              />
            )}
            <TextField control={form.control} name="note" label={t("leads.fields.statusNote")} multiline />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("leads.saveStatus")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A manager hands the lead to someone who receives leads (BR-203). */
export function AssignLeadButton({ lead, assignees }: { lead: Lead; assignees: { id: string; name: string }[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useSubmit();
  const form = useForm<{ userId: string }>({
    resolver: zodResolver(leadAssignSchema) as never,
    defaultValues: { userId: lead.pic?.id ?? "" },
  });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => assignLeadAction(lead.id, values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("leads.assigned"));
        setOpen(false);
        router.refresh();
      },
    ),
  );

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserRoundCogIcon />
        {lead.pic ? t("leads.reassign") : t("leads.assign")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <DialogHeader>
              <DialogTitle>{t("leads.assignTitle", { name: lead.fullName })}</DialogTitle>
              <DialogDescription>
                {assignees.length > 0 ? t("leads.assignDescription") : t("leads.noAssignees")}
              </DialogDescription>
            </DialogHeader>
            {assignees.length > 0 && (
              <SelectField
                control={form.control}
                name="userId"
                label={t("leads.fields.pic")}
                options={assignees.map((user) => ({ value: user.id, label: user.name }))}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending || assignees.length === 0}>
                {t("leads.saveAssignment")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
