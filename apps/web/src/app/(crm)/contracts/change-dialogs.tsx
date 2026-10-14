"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowRightLeftIcon,
  BuildingIcon,
  GiftIcon,
  PauseCircleIcon,
  RefreshCwIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectField, TextField, applyFieldErrors, useValidationMessage } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useCustomerSearch } from "@/components/use-customer-search";
import {
  branchTransferInputSchema,
  exchangeInputSchema,
  holdInputSchema,
  renewalInputSchema,
  transferInputSchema,
  type BranchTransferInput,
  type ExchangeInput,
  type HoldInput,
  type RenewalInput,
  type TransferInput,
} from "@flow/shared/changes";
import { useSubmit } from "../admin/users/user-dialogs";
import {
  raiseBranchTransferAction,
  raiseExchangeAction,
  raiseHoldAction,
  raiseRenewalAction,
  raiseTransferAction,
} from "./change-actions";

type ContractRef = { id: string; contractCode: string };

/** The dialog both buttons open: the fields, and the save that tells whether the voucher waits for approval. */
function VoucherDialog<T extends Record<string, string>>({
  title,
  description,
  form,
  run,
  onClose,
  children,
}: {
  title: string;
  description: string;
  form: ReturnType<typeof useForm<T>>;
  /** Raises the voucher; the key is made when the dialog opens and kept for retries (T-015). */
  run: (values: T, key: string) => ReturnType<typeof raiseRenewalAction>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("contractChanges");
  const common = useTranslations("common");
  const router = useRouter();
  const { pending, run: submit } = useSubmit();
  const [key] = useState(() => crypto.randomUUID());
  const onSubmit = form.handleSubmit((values) =>
    submit(
      () => run(values, key),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      (data) => {
        notify.success(data.pending ? t("raisedPending") : t("raisedDone"));
        onClose();
        router.refresh();
      },
    ),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <FieldGroup>{children}</FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {common("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? common("saving") : t("raise")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type RenewalValues = { fromDate: string; months: string; days: string; sessions: string; amount: string; note: string };

/** A renewal: months, days or sessions added to the contract, and the amount to pay for them (brief §5.6). */
export function RenewalButton({ contract }: { contract: ContractRef }) {
  const t = useTranslations("contractChanges");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RefreshCwIcon />
        {t("renewal")}
      </Button>
      {open && <RenewalDialog contract={contract} onClose={() => setOpen(false)} />}
    </>
  );
}

function RenewalDialog({ contract, onClose }: { contract: ContractRef; onClose: () => void }) {
  const t = useTranslations("contractChanges");
  const form = useForm<RenewalValues>({
    resolver: ((values: RenewalValues, context: unknown, options: never) =>
      zodResolver(renewalInputSchema as never, undefined, { raw: true })(
        { contractId: contract.id, ...values } as never,
        context as never,
        options,
      )) as never,
    defaultValues: { fromDate: "", months: "", days: "", sessions: "", amount: "", note: "" },
  });
  return (
    <VoucherDialog
      title={t("renewalTitle", { code: contract.contractCode })}
      description={t("renewalDescription")}
      form={form}
      run={(values, key) => raiseRenewalAction({ contractId: contract.id, ...values } as RenewalInput, key)}
      onClose={onClose}
    >
      <TextField control={form.control} name="fromDate" label={t("fields.fromDate")} placeholder={t("fromHint")} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField control={form.control} name="months" label={t("fields.months")} inputMode="numeric" />
        <TextField control={form.control} name="days" label={t("fields.days")} inputMode="numeric" />
        <TextField control={form.control} name="sessions" label={t("fields.sessions")} inputMode="numeric" />
      </div>
      <TextField control={form.control} name="amount" label={t("fields.amount")} inputMode="numeric" />
      <TextField control={form.control} name="note" label={t("fields.note")} multiline />
    </VoucherDialog>
  );
}

type HoldValues = { fromDate: string; toDate: string; note: string };

/** A hold: the contract stops for the days asked, which are added to its end (brief §5.6). */
export function HoldButton({ contract }: { contract: ContractRef }) {
  const t = useTranslations("contractChanges");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PauseCircleIcon />
        {t("hold")}
      </Button>
      {open && <HoldDialog contract={contract} onClose={() => setOpen(false)} />}
    </>
  );
}

function HoldDialog({ contract, onClose }: { contract: ContractRef; onClose: () => void }) {
  const t = useTranslations("contractChanges");
  const form = useForm<HoldValues>({
    resolver: ((values: HoldValues, context: unknown, options: never) =>
      zodResolver(holdInputSchema as never, undefined, { raw: true })(
        { contractId: contract.id, ...values } as never,
        context as never,
        options,
      )) as never,
    defaultValues: { fromDate: "", toDate: "", note: "" },
  });
  return (
    <VoucherDialog
      title={t("holdTitle", { code: contract.contractCode })}
      description={t("holdDescription")}
      form={form}
      run={(values, key) => raiseHoldAction({ contractId: contract.id, ...values } as HoldInput, key)}
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="fromDate" label={t("fields.fromDate")} placeholder={t("dayHint")} />
        <TextField control={form.control} name="toDate" label={t("fields.toDate")} placeholder={t("dayHint")} />
      </div>
      <TextField control={form.control} name="note" label={t("fields.note")} multiline />
    </VoucherDialog>
  );
}

type ExchangeValues = { targetServiceId: string; sessions: string; amount: string; credit: string; note: string };
type ServiceRef = { id: string; name: string };

/** An upgrade or a conversion: what is left of the package is exchanged for a new service (brief §5.6, A-227). */
export function ExchangeButton({
  kind,
  contract,
  services,
}: {
  kind: "upgrades" | "conversions";
  contract: ContractRef;
  services: ServiceRef[];
}) {
  const t = useTranslations("contractChanges");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {kind === "upgrades" ? <TrendingUpIcon /> : <ArrowRightLeftIcon />}
        {kind === "upgrades" ? t("upgrade") : t("conversion")}
      </Button>
      {open && <ExchangeDialog kind={kind} contract={contract} services={services} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExchangeDialog({
  kind,
  contract,
  services,
  onClose,
}: {
  kind: "upgrades" | "conversions";
  contract: ContractRef;
  services: ServiceRef[];
  onClose: () => void;
}) {
  const t = useTranslations("contractChanges");
  const form = useForm<ExchangeValues>({
    resolver: ((values: ExchangeValues, context: unknown, options: never) =>
      zodResolver(exchangeInputSchema as never, undefined, { raw: true })(
        { contractId: contract.id, ...values } as never,
        context as never,
        options,
      )) as never,
    defaultValues: { targetServiceId: "", sessions: "", amount: "", credit: "", note: "" },
  });
  const upgrade = kind === "upgrades";
  return (
    <VoucherDialog
      title={t(upgrade ? "upgradeTitle" : "conversionTitle", { code: contract.contractCode })}
      description={t("exchangeDescription")}
      form={form}
      run={(values, key) => raiseExchangeAction(kind, { contractId: contract.id, ...values } as ExchangeInput, key)}
      onClose={onClose}
    >
      <SelectField
        control={form.control}
        name="targetServiceId"
        label={t("fields.targetService")}
        placeholder={t("targetPlaceholder")}
        options={services.map((service) => ({ value: service.id, label: service.name }))}
      />
      <TextField control={form.control} name="sessions" label={t("fields.newSessions")} inputMode="numeric" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="amount" label={t("fields.newPrice")} inputMode="numeric" />
        <TextField control={form.control} name="credit" label={t("fields.credit")} inputMode="numeric" />
      </div>
      <TextField control={form.control} name="note" label={t("fields.note")} multiline />
    </VoucherDialog>
  );
}

type TransferValues = { toCustomerId: string; credit: string; note: string };

/** A transfer: the sessions left, and the value that goes with them, are given to another customer (brief §5.6). */
export function TransferButton({ contract }: { contract: ContractRef }) {
  const t = useTranslations("contractChanges");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <GiftIcon />
        {t("transfer")}
      </Button>
      {open && <TransferDialog contract={contract} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Finds the customer who receives the sessions by code, name or phone; the API checks the branch. */
function CustomerPickField({
  control,
  name,
}: {
  control: ReturnType<typeof useForm<TransferValues>>["control"];
  name: "toCustomerId";
}) {
  const t = useTranslations("contractChanges");
  const validationMessage = useValidationMessage();
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const results = useCustomerSearch(query, 6);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor="transfer-customer">{t("fields.toCustomer")}</FieldLabel>
          {field.value ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{label}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  field.onChange("");
                  setLabel("");
                }}
              >
                {t("changeCustomer")}
              </Button>
            </div>
          ) : (
            <>
              <Input
                id="transfer-customer"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("customerSearch")}
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {results.length > 0 && (
                <ul className="divide-y rounded-md border">
                  {results.map((customer) => (
                    <li key={customer.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => {
                          field.onChange(customer.id);
                          setLabel(`${customer.customerCode} · ${customer.fullName}`);
                          setQuery("");
                        }}
                      >
                        {customer.customerCode} · {customer.fullName}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {fieldState.error?.message && <FieldError>{validationMessage(fieldState.error.message)}</FieldError>}
        </Field>
      )}
    />
  );
}

function TransferDialog({ contract, onClose }: { contract: ContractRef; onClose: () => void }) {
  const t = useTranslations("contractChanges");
  const form = useForm<TransferValues>({
    resolver: ((values: TransferValues, context: unknown, options: never) =>
      zodResolver(transferInputSchema as never, undefined, { raw: true })(
        { contractId: contract.id, ...values } as never,
        context as never,
        options,
      )) as never,
    defaultValues: { toCustomerId: "", credit: "", note: "" },
  });
  return (
    <VoucherDialog
      title={t("transferTitle", { code: contract.contractCode })}
      description={t("transferDescription")}
      form={form}
      run={(values, key) => raiseTransferAction({ contractId: contract.id, ...values } as TransferInput, key)}
      onClose={onClose}
    >
      <CustomerPickField control={form.control} name="toCustomerId" />
      <TextField control={form.control} name="credit" label={t("fields.transferValue")} inputMode="numeric" />
      <TextField control={form.control} name="note" label={t("fields.note")} multiline />
    </VoucherDialog>
  );
}

type BranchTransferValues = { toBranchId: string; fee: string; note: string };

/** A branch transfer: the contract moves to another branch for a fee (brief §5.6). */
export function BranchTransferButton({
  contract,
  branches,
}: {
  contract: ContractRef;
  branches: { id: string; name: string }[];
}) {
  const t = useTranslations("contractChanges");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <BuildingIcon />
        {t("branchTransfer")}
      </Button>
      {open && <BranchTransferDialog contract={contract} branches={branches} onClose={() => setOpen(false)} />}
    </>
  );
}

function BranchTransferDialog({
  contract,
  branches,
  onClose,
}: {
  contract: ContractRef;
  branches: { id: string; name: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("contractChanges");
  const form = useForm<BranchTransferValues>({
    resolver: ((values: BranchTransferValues, context: unknown, options: never) =>
      zodResolver(branchTransferInputSchema as never, undefined, { raw: true })(
        { contractId: contract.id, ...values } as never,
        context as never,
        options,
      )) as never,
    defaultValues: { toBranchId: "", fee: "", note: "" },
  });
  return (
    <VoucherDialog
      title={t("branchTransferTitle", { code: contract.contractCode })}
      description={t("branchTransferDescription")}
      form={form}
      run={(values, key) =>
        raiseBranchTransferAction({ contractId: contract.id, ...values } as BranchTransferInput, key)
      }
      onClose={onClose}
    >
      <SelectField
        control={form.control}
        name="toBranchId"
        label={t("fields.toBranch")}
        placeholder={t("branchPlaceholder")}
        options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
      />
      <TextField control={form.control} name="fee" label={t("fields.fee")} inputMode="numeric" />
      <TextField control={form.control} name="note" label={t("fields.note")} multiline />
    </VoucherDialog>
  );
}
