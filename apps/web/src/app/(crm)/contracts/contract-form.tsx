"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm, useFormState, useWatch, type Control } from "react-hook-form";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { CheckboxField, SelectField, SwitchField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { NO_OPTION, OptionSelect } from "@/components/option-select";
import { useErrorMessage } from "@/components/use-error-message";
import { useValidationMessage } from "@/components/form-fields";
import type { ActionResult } from "@/lib/actions/result";
import { SOLD_CONTRACT_TYPES, sharesProblems } from "@flow/shared/contracts";
import { CompanionPicker, type Companion } from "./companion-picker";
import { ContractPricePanel } from "./contract-price-panel";

type ShareRow = { employeeId: string; percent: string };

/** Everything the form holds is text or a list of text; the API reads and checks it (BR-301). */
export type ContractFormValues = {
  serviceId: string;
  sessions: string;
  contractType: string;
  previousContractId: string;
  contractDate: string;
  startDate: string;
  activationDeadline: string;
  bonusSessions: string;
  bonusMonths: string;
  bonusDays: string;
  promotionId: string;
  voucherCode: string;
  vatPercent: string;
  isException: boolean;
  proposedUnitPrice: string;
  exceptionReasonId: string;
  exceptionNote: string;
  ptShares: ShareRow[];
  saleShares: ShareRow[];
  signed: boolean;
  signedOn: string;
  signedBy: string;
  signatureNote: string;
  firstAmount: string;
  firstMethodId: string;
  firstMethodNote: string;
  paymentDueOn: string;
  notes: string;
};

export const EMPTY_CONTRACT: ContractFormValues = {
  serviceId: "",
  sessions: "",
  contractType: "NEW",
  previousContractId: NO_OPTION,
  contractDate: "",
  startDate: "",
  activationDeadline: "",
  bonusSessions: "0",
  bonusMonths: "0",
  bonusDays: "0",
  promotionId: NO_OPTION,
  voucherCode: "",
  vatPercent: "0",
  isException: false,
  proposedUnitPrice: "",
  exceptionReasonId: "",
  exceptionNote: "",
  ptShares: [],
  saleShares: [{ employeeId: "", percent: "100" }],
  signed: false,
  signedOn: "",
  signedBy: "",
  signatureNote: "",
  firstAmount: "",
  firstMethodId: "",
  firstMethodNote: "",
  paymentDueOn: "",
  notes: "",
};

export type ServiceChoice = {
  id: string;
  name: string;
  kind: "PT" | "CLASS" | "MEMBER";
  isGroup: boolean;
  maxMembers: number | null;
  quickPackages: number[];
};
type StaffChoice = { id: string; fullName: string; employeeCode: string; isTrainer: boolean };

type Props = {
  customer: { id: string };
  services: ServiceChoice[];
  promotions: { id: string; name: string }[];
  staff: StaffChoice[];
  /** The customer's earlier contracts, for a renewal to follow. */
  previousContracts: { id: string; label: string }[];
  defaultValues: ContractFormValues;
  defaultCompanions: Companion[];
  /** The first payment is taken only when a contract is created (A-119). */
  withFirstPayment: boolean;
  /** The voucher a draft already uses; its code is not shown, so it is typed again to keep it. */
  voucherName?: string | null;
  submitLabel: string;
  cancelHref: string;
  submit: (input: unknown) => Promise<ActionResult<unknown>>;
  onSaved: (result: unknown) => void;
};

const blank = (value: string) => (value === NO_OPTION ? "" : value);

/** What the API takes from the form's text (FR-CON-001); hidden sections send nothing. */
function toInput(
  values: ContractFormValues,
  service: ServiceChoice | undefined,
  companions: Companion[],
  withFirstPayment: boolean,
) {
  const exception = values.isException;
  return {
    serviceId: values.serviceId,
    sessions: values.sessions,
    contractType: values.contractType,
    previousContractId: values.contractType === "RENEW" ? blank(values.previousContractId) : "",
    contractDate: values.contractDate,
    startDate: values.startDate,
    activationDeadline: values.activationDeadline,
    bonusSessions: values.bonusSessions || "0",
    bonusMonths: values.bonusMonths || "0",
    bonusDays: values.bonusDays || "0",
    promotionId: exception ? "" : blank(values.promotionId),
    voucherCode: exception ? "" : values.voucherCode,
    vatPercent: values.vatPercent || "0",
    proposedUnitPrice: exception ? values.proposedUnitPrice : "",
    exceptionReasonId: exception ? values.exceptionReasonId : "",
    exceptionNote: exception ? values.exceptionNote : "",
    ptShares: service?.kind === "PT" ? values.ptShares : [],
    saleShares: values.saleShares,
    companionIds: service?.isGroup ? companions.map((companion) => companion.id) : [],
    signed: values.signed,
    signedOn: values.signed ? values.signedOn : "",
    signedBy: values.signed ? values.signedBy : "",
    signatureNote: values.signatureNote,
    firstPayment:
      withFirstPayment && values.firstAmount.trim()
        ? { amount: values.firstAmount, methodId: values.firstMethodId, methodNote: values.firstMethodNote }
        : null,
    paymentDueOn: values.paymentDueOn,
    notes: values.notes,
  };
}

/** Where the API's field errors show on this form. */
const FIELD_OF: Record<string, string> = { firstPayment: "firstAmount" };

/**
 * The contract form (FR-CON-001, FR-CON-002): the service, the number of sessions, dates, promotion, VAT, an exception
 * price, PT and Sale shares, signature, and the first payment. The price panel shows what the API works out; nobody types
 * a unit price unless it is an exception (BR-301, BR-302).
 */
export function ContractForm(props: Props) {
  const { customer, services, promotions, staff, previousContracts, withFirstPayment } = props;
  const t = useTranslations("contracts");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const validationMessage = useValidationMessage();
  const [pending, startTransition] = useTransition();
  const [companions, setCompanions] = useState<Companion[]>(props.defaultCompanions);
  const [companionError, setCompanionError] = useState<string | null>(null);
  const form = useForm<ContractFormValues>({ defaultValues: props.defaultValues });

  const serviceId = useWatch({ control: form.control, name: "serviceId" });
  const contractType = useWatch({ control: form.control, name: "contractType" });
  const isException = useWatch({ control: form.control, name: "isException" });
  const signed = useWatch({ control: form.control, name: "signed" });
  const service = services.find((candidate) => candidate.id === serviceId);

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      setCompanionError(null);
      const result = await props.submit(toInput(values, service, companions, withFirstPayment));
      if (result.ok) return props.onSaved(result.data);
      const errors = result.fieldErrors ?? {};
      if (errors.companionIds?.[0]) setCompanionError(errors.companionIds[0]);
      applyFieldErrors(
        form.setError,
        Object.fromEntries(Object.entries(errors).map(([field, messages]) => [FIELD_OF[field] ?? field, messages])),
      );
      notify.error(errorMessage(result.code));
    }),
  );

  const f = (key: string) => t(`form.${key}` as never);
  const todayHint = "dd/mm/yyyy";

  return (
    <form onSubmit={onSubmit} noValidate className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <Section title={t("sections.service")}>
          {services.length === 0 ? (
            <p className="text-sm text-muted-foreground">{f("noServices")}</p>
          ) : (
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  control={form.control}
                  name="serviceId"
                  label={f("service")}
                  placeholder={f("servicePlaceholder")}
                  options={services.map((choice) => ({ value: choice.id, label: choice.name }))}
                />
                <SelectField
                  control={form.control}
                  name="contractType"
                  label={f("contractType")}
                  options={SOLD_CONTRACT_TYPES.map((type) => ({ value: type, label: t(`types.${type}`) }))}
                />
              </div>
              {contractType === "RENEW" && (
                <SelectField
                  control={form.control}
                  name="previousContractId"
                  label={f("previousContract")}
                  options={[
                    { value: NO_OPTION, label: f("noPrevious") },
                    ...previousContracts.map((contract) => ({ value: contract.id, label: contract.label })),
                  ]}
                />
              )}
              <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
                <TextField control={form.control} name="sessions" label={f("sessions")} inputMode="numeric" />
                {service && service.quickPackages.length > 0 && (
                  <div role="group" aria-label={f("quickPick")} className="flex flex-wrap gap-2 pb-1">
                    {service.quickPackages.map((count) => (
                      <Button
                        key={count}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => form.setValue("sessions", String(count), { shouldDirty: true })}
                      >
                        {count}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  control={form.control}
                  name="contractDate"
                  label={f("contractDate")}
                  placeholder={todayHint}
                />
                <TextField control={form.control} name="startDate" label={f("startDate")} placeholder={todayHint} />
                <TextField
                  control={form.control}
                  name="activationDeadline"
                  label={f("activationDeadline")}
                  placeholder={todayHint}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField control={form.control} name="bonusSessions" label={f("bonusSessions")} inputMode="numeric" />
                <TextField control={form.control} name="bonusMonths" label={f("bonusMonths")} inputMode="numeric" />
                <TextField control={form.control} name="bonusDays" label={f("bonusDays")} inputMode="numeric" />
              </div>
              {service?.isGroup && (
                <>
                  <CompanionPicker
                    value={companions}
                    onChange={setCompanions}
                    ownerId={customer.id}
                    max={(service.maxMembers ?? 1) - 1}
                  />
                  {companionError && <FieldError>{validationMessage(companionError)}</FieldError>}
                </>
              )}
            </FieldGroup>
          )}
        </Section>

        <Section title={t("sections.price")}>
          <FieldGroup>
            <SwitchField
              control={form.control}
              name="isException"
              label={f("exception")}
              description={f("exceptionHint")}
            />
            {isException ? (
              <>
                <TextField
                  control={form.control}
                  name="proposedUnitPrice"
                  label={f("proposedUnitPrice")}
                  inputMode="numeric"
                />
                <OptionSelect
                  control={form.control}
                  name="exceptionReasonId"
                  noteName="exceptionNote"
                  listKey="exceptionPriceReasons"
                  label={f("exceptionReason")}
                />
              </>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  control={form.control}
                  name="promotionId"
                  label={f("promotion")}
                  options={[
                    { value: NO_OPTION, label: f("noPromotion") },
                    ...promotions.map((promotion) => ({ value: promotion.id, label: promotion.name })),
                  ]}
                />
                <TextField
                  control={form.control}
                  name="voucherCode"
                  label={f("voucher")}
                  description={props.voucherName ? t("form.voucherKept", { name: props.voucherName }) : undefined}
                  autoComplete="off"
                />
              </div>
            )}
            <div className="max-w-40">
              <TextField control={form.control} name="vatPercent" label={f("vat")} inputMode="decimal" />
            </div>
          </FieldGroup>
        </Section>

        <Section title={t("sections.staff")}>
          <FieldGroup>
            {service?.kind === "PT" && (
              <ShareRows
                control={form.control}
                name="ptShares"
                title={f("ptShares")}
                staff={staff.filter((s) => s.isTrainer)}
              />
            )}
            <ShareRows control={form.control} name="saleShares" title={f("saleShares")} staff={staff} />
          </FieldGroup>
        </Section>

        <Section title={t("sections.sign")}>
          <FieldGroup>
            <CheckboxField control={form.control} name="signed" label={f("signed")} />
            {signed && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField control={form.control} name="signedOn" label={f("signedOn")} placeholder={todayHint} />
                <TextField control={form.control} name="signedBy" label={f("signedBy")} autoComplete="off" />
                <div className="sm:col-span-2">
                  <TextField control={form.control} name="signatureNote" label={f("signatureNote")} />
                </div>
              </div>
            )}
            {withFirstPayment && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">{f("firstPayment")}</legend>
                <p className="text-sm text-muted-foreground">{f("firstPaymentHint")}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField control={form.control} name="firstAmount" label={f("firstAmount")} inputMode="numeric" />
                  <OptionSelect
                    control={form.control}
                    name="firstMethodId"
                    noteName="firstMethodNote"
                    listKey="paymentMethods"
                    label={f("firstMethod")}
                  />
                </div>
              </fieldset>
            )}
            <div className="max-w-60">
              <TextField control={form.control} name="paymentDueOn" label={f("paymentDueOn")} placeholder={todayHint} />
            </div>
          </FieldGroup>
        </Section>

        <Section title={t("sections.notes")}>
          <TextField control={form.control} name="notes" label={f("notes")} multiline />
        </Section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => router.push(props.cancelHref)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={pending || services.length === 0}>
            {props.submitLabel}
          </Button>
        </div>
      </div>
      <ContractPricePanel control={form.control} />
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription className="sr-only">{title}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** One role's shares (A-115): who, and their percent; the total must reach 100. */
function ShareRows({
  control,
  name,
  title,
  staff,
}: {
  control: Control<ContractFormValues>;
  name: "ptShares" | "saleShares";
  title: string;
  staff: StaffChoice[];
}) {
  const t = useTranslations("contracts.form");
  const validationMessage = useValidationMessage();
  const rows = useFieldArray({ control, name });
  const values = useWatch({ control, name });
  const total = values.reduce((sum, row) => sum + (Number(row.percent.replace(",", ".")) || 0), 0);
  const problems =
    values.length > 0
      ? sharesProblems(
          values.map((row) => ({ employeeId: row.employeeId, percent: Number(row.percent.replace(",", ".")) || 0 })),
          true,
        )
      : [];
  const { errors } = useFormState({ control, name });
  const error = errors[name]?.message ?? errors[name]?.root?.message;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{title}</legend>
      {rows.fields.map((row, index) => (
        <div key={row.id} className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_auto]">
          <SelectField
            control={control}
            name={`${name}.${index}.employeeId`}
            label={`${title}: ${t("employee")} ${index + 1}`}
            options={staff.map((employee) => ({
              value: employee.id,
              label: `${employee.employeeCode} · ${employee.fullName}`,
            }))}
          />
          <TextField
            control={control}
            name={`${name}.${index}.percent`}
            label={`${title}: ${t("percent")} ${index + 1}`}
            inputMode="decimal"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => rows.remove(index)}
            aria-label={t("removeShare", { name: `${title} ${index + 1}` })}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => rows.append({ employeeId: "", percent: rows.fields.length === 0 ? "100" : "" })}
        >
          <PlusIcon />
          {t("addShare")}
        </Button>
        {values.length > 0 && (
          <span
            className={problems.includes("sharesTotal") ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
          >
            {t("sharesTotal", { total: Math.round(total * 100) / 100 })}
          </span>
        )}
      </div>
      {error && <FieldError>{validationMessage(error)}</FieldError>}
    </fieldset>
  );
}
