"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronDownIcon, PencilIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { NO_OPTION, OptionSelect } from "@/components/option-select";
import { DuplicateNotice } from "@/components/duplicate-notice";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { DuplicatePerson } from "@/lib/api/errors";
import { formatDateOnly } from "@/lib/format";
import { GENDERS } from "@flow/shared/employees";
import { NATIONALITY_GROUPS, SOURCE_TYPES, leadInputSchema, type Lead } from "@flow/shared/leads";
import { createLeadAction, updateLeadAction } from "./actions";

type BranchOption = { id: string; name: string };

type FormValues = {
  branchId: string;
  fullName: string;
  phone: string;
  channelId: string;
  channelNote: string;
  gender: string;
  birthDate: string;
  email: string;
  sourceId: string;
  sourceNote: string;
  sourceType: string;
  sourceDetail: string;
  nationalityGroup: string;
  needGroupId: string;
  needGroupNote: string;
  needDetail: string;
  painStatusId: string;
  painStatusNote: string;
  assessmentTypeId: string;
  assessmentTypeNote: string;
  notes: string;
};

/** Select items cannot be empty, so "none" has its own value; it is sent as "". */
const fromNone = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === NO_OPTION ? "" : value]));
// The schema the server uses, after "none" becomes "" (D-016).
const formSchema = z.preprocess((value) => fromNone(value as Record<string, unknown>), leadInputSchema);

function defaultsOf(lead: Lead | null): FormValues {
  const id = (option: { id: string } | null) => option?.id ?? NO_OPTION;
  return {
    branchId: lead?.branch.id ?? "",
    fullName: lead?.fullName ?? "",
    phone: lead?.phone ?? "",
    channelId: lead?.channel.id ?? "",
    channelNote: lead?.channel.note ?? "",
    gender: lead?.gender ?? NO_OPTION,
    birthDate: lead?.birthDate ? formatDateOnly(lead.birthDate) : "",
    email: lead?.email ?? "",
    sourceId: id(lead?.source ?? null),
    sourceNote: lead?.source?.note ?? "",
    sourceType: lead?.sourceType ?? NO_OPTION,
    sourceDetail: lead?.sourceDetail ?? "",
    nationalityGroup: lead?.nationalityGroup ?? NO_OPTION,
    needGroupId: id(lead?.needGroup ?? null),
    needGroupNote: lead?.needGroup?.note ?? "",
    needDetail: lead?.needDetail ?? "",
    painStatusId: id(lead?.painStatus ?? null),
    painStatusNote: lead?.painStatus?.note ?? "",
    assessmentTypeId: id(lead?.assessmentType ?? null),
    assessmentTypeNote: lead?.assessmentType?.note ?? "",
    notes: lead?.notes ?? "",
  };
}

export function AddLeadButton({ branches }: { branches: BranchOption[] }) {
  const t = useTranslations("leads");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon />
        {t("create")}
      </Button>
      <LeadSheet open={open} onOpenChange={setOpen} lead={null} branches={branches} />
    </>
  );
}

export function EditLeadButton({ lead }: { lead: Lead }) {
  const t = useTranslations("leads");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t("edit")}
      </Button>
      <LeadSheet open={open} onOpenChange={setOpen} lead={lead} branches={[]} />
    </>
  );
}

type SheetProps = { open: boolean; onOpenChange: (open: boolean) => void; lead: Lead | null; branches: BranchOption[] };

/** A sheet: phones get the whole screen (AC-23, docs/23 §7). */
function LeadSheet({ open, onOpenChange, lead, branches }: SheetProps) {
  const t = useTranslations("leads");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{lead ? t("edit") : t("create")}</SheetTitle>
          <SheetDescription>{lead ? t("editDescription") : t("createDescription")}</SheetDescription>
        </SheetHeader>
        <LeadForm key={lead?.id ?? "new"} lead={lead} branches={branches} onDone={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function LeadForm({ lead, branches, onDone }: { lead: Lead | null; branches: BranchOption[]; onDone: () => void }) {
  const t = useTranslations();
  const f = useTranslations("leads.fields");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const [duplicate, setDuplicate] = useState<DuplicatePerson | null>(null);
  // A new lead starts with the three things reception asks first; the rest unfolds.
  const [more, setMore] = useState(lead !== null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as never, undefined, { raw: true }) as never,
    defaultValues: defaultsOf(lead),
  });
  const masked = lead?.maskedFields ?? [];
  const none = t("leads.noOption");

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const { branchId, ...fields } = fromNone(values) as FormValues;
      const result = lead ? await updateLeadAction(lead.id, fields) : await createLeadAction({ ...fields, branchId });
      if (!result.ok) {
        setDuplicate(result.duplicate ?? null);
        applyFieldErrors(form.setError, result.fieldErrors);
        return void notify.error(errorMessage(result.code));
      }
      onDone();
      if (lead) {
        notify.success(t("leads.updated"));
        router.refresh();
      } else {
        const created = result.data as { id: string; leadCode: string };
        notify.success(t("leads.created", { code: created.leadCode }));
        router.push(`/leads/${created.id}`);
      }
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <FieldGroup className="flex-1 overflow-y-auto px-4 pb-4">
        {!lead && branches.length > 1 && (
          <SelectField
            control={form.control}
            name="branchId"
            label={f("branch")}
            placeholder={t("common.chooseBranch")}
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
        )}
        <TextField control={form.control} name="fullName" label={f("fullName")} autoComplete="off" />
        {!masked.includes("phone") && (
          <TextField
            control={form.control}
            name="phone"
            label={f("phone")}
            type="tel"
            inputMode="tel"
            placeholder={t("leads.phonePlaceholder")}
          />
        )}
        <OptionSelect
          control={form.control}
          name="channelId"
          noteName="channelNote"
          listKey="leadChannels"
          label={f("channel")}
        />
        <DuplicateNotice duplicate={duplicate} />
        {!more ? (
          <Button type="button" variant="ghost" className="justify-start" onClick={() => setMore(true)}>
            <ChevronDownIcon />
            {t("leads.moreDetails")}
          </Button>
        ) : (
          <>
            <OptionSelect
              control={form.control}
              name="sourceId"
              noteName="sourceNote"
              listKey="leadSources"
              label={f("source")}
              noneLabel={none}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="sourceType"
                label={f("sourceType")}
                options={[
                  { value: NO_OPTION, label: none },
                  ...SOURCE_TYPES.map((value) => ({ value, label: t(`leads.sourceTypes.${value}`) })),
                ]}
              />
              <TextField control={form.control} name="sourceDetail" label={f("sourceDetail")} autoComplete="off" />
            </div>
            <OptionSelect
              control={form.control}
              name="needGroupId"
              noteName="needGroupNote"
              listKey="needGroups"
              label={f("needGroup")}
              noneLabel={none}
            />
            <TextField control={form.control} name="needDetail" label={f("needDetail")} multiline />
            <div className="grid gap-4 sm:grid-cols-2">
              <OptionSelect
                control={form.control}
                name="painStatusId"
                noteName="painStatusNote"
                listKey="painStatuses"
                label={f("painStatus")}
                noneLabel={none}
              />
              <OptionSelect
                control={form.control}
                name="assessmentTypeId"
                noteName="assessmentTypeNote"
                listKey="assessmentTypes"
                label={f("assessmentType")}
                noneLabel={none}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="gender"
                label={f("gender")}
                options={[
                  { value: NO_OPTION, label: none },
                  ...GENDERS.map((value) => ({ value, label: t(`leads.genders.${value}`) })),
                ]}
              />
              <TextField
                control={form.control}
                name="birthDate"
                label={f("birthDate")}
                placeholder={t("leads.birthDatePlaceholder")}
                inputMode="numeric"
              />
            </div>
            {!masked.includes("email") && (
              <TextField control={form.control} name="email" label={f("email")} type="email" />
            )}
            <SelectField
              control={form.control}
              name="nationalityGroup"
              label={f("nationalityGroup")}
              options={[
                { value: NO_OPTION, label: none },
                ...NATIONALITY_GROUPS.map((value) => ({ value, label: t(`leads.nationalityGroups.${value}`) })),
              ]}
            />
            <TextField control={form.control} name="notes" label={f("notes")} multiline />
          </>
        )}
      </FieldGroup>
      <div className="flex justify-end gap-2 border-t p-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
