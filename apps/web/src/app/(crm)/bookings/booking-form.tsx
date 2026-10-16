"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTimeZone, useTranslations } from "next-intl";
import { Controller, useForm, useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { SelectField, TextField, applyFieldErrors, useValidationMessage } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import {
  MIN_CUSTOMER_QUERY_LENGTH,
  useCustomerSearch,
  type CustomerSearchResult,
} from "@/components/use-customer-search";
import type { ActionResult } from "@/lib/actions/result";
import { formatDate, formatTime } from "@/lib/format";
import { bookingInputSchema, rescheduleSchema } from "@gymcrm/shared/bookings";
import { createBookingAction, rescheduleBookingAction } from "./actions";
import type { BookingRow, TrainerOption } from "./booking-types";

/** A customer or contract chosen before the form opens (e.g. from its own page). */
export type FixedChoice = { id: string; label: string };

export type BookingPreset = {
  customer?: FixedChoice;
  contract?: FixedChoice;
  trainerId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
};

type BookingFormValues = {
  customerId: string;
  contractId: string;
  trainerId: string;
  date: string;
  startTime: string;
  endTime: string;
};

type BookingFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trainers: TrainerOption[];
} & ({ mode: "create"; preset?: BookingPreset } | { mode: "reschedule"; booking: BookingRow });

/** Add or reschedule a booking: six fields or fewer, so a Dialog (docs/23 §7). */
export function BookingFormDialog(props: BookingFormDialogProps) {
  const t = useTranslations("bookings");
  const create = props.mode === "create";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{create ? t("create") : t("reschedule")}</DialogTitle>
          <DialogDescription>{create ? t("createDescription") : t("rescheduleDescription")}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts from fresh values. */}
        <BookingForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function BookingForm(props: BookingFormDialogProps) {
  const t = useTranslations();
  const router = useRouter();
  const timeZone = useTimeZone() ?? "UTC";
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();

  const preset: BookingPreset = props.mode === "create" ? (props.preset ?? {}) : {};
  const booking = props.mode === "reschedule" ? props.booking : null;
  const form = useForm<BookingFormValues>({
    resolver: zodResolver(booking ? rescheduleSchema : bookingInputSchema, undefined, { raw: true }) as never,
    defaultValues: booking
      ? {
          customerId: booking.customer.id,
          contractId: booking.contract.id,
          trainerId: booking.trainer.id,
          date: formatDate(booking.scheduledStart, timeZone),
          startTime: formatTime(booking.scheduledStart, timeZone),
          endTime: formatTime(booking.scheduledEnd, timeZone),
        }
      : {
          customerId: preset.customer?.id ?? "",
          contractId: preset.contract?.id ?? "",
          trainerId: preset.trainerId ?? (props.trainers.length === 1 ? props.trainers[0].id : ""),
          date: preset.date ?? "",
          startTime: preset.startTime ?? "",
          endTime: preset.endTime ?? "",
        },
  });

  const customerId = useWatch({ control: form.control, name: "customerId" });
  const fixedContract = booking ? { id: booking.contract.id, label: booking.contract.contractCode } : preset.contract;
  const contracts = useBookableContracts(fixedContract ? "" : customerId);

  // A booking keeps its trainer in the list even if the trainer has since stopped taking bookings.
  const trainerOptions = [
    ...props.trainers,
    ...(booking && !props.trainers.some((tr) => tr.id === booking.trainer.id) ? [booking.trainer] : []),
  ].map((trainer) => ({ value: trainer.id, label: `${trainer.fullName} · ${trainer.employeeCode}` }));

  const submit = (values: BookingFormValues): Promise<ActionResult> =>
    booking ? rescheduleBookingAction(booking.id, values) : createBookingAction(values);

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await submit(values);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t(booking ? "bookings.rescheduled" : "bookings.created"));
      props.onOpenChange(false);
      router.refresh();
    }),
  );

  const fields = "bookings.fields" as const;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FieldGroup>
        {booking ? (
          <ReadOnlyField
            label={t(`${fields}.customer`)}
            value={`${booking.customer.customerCode} · ${booking.customer.fullName}`}
          />
        ) : preset.customer ? (
          <ReadOnlyField label={t(`${fields}.customer`)} value={preset.customer.label} />
        ) : (
          <CustomerPicker control={form.control} onPicked={() => form.setValue("contractId", "")} />
        )}
        {fixedContract ? (
          <ReadOnlyField label={t(`${fields}.contract`)} value={fixedContract.label} />
        ) : customerId && contracts?.length === 0 ? (
          <ReadOnlyField label={t(`${fields}.contract`)} value={t("bookings.noBookableContracts")} />
        ) : (
          <SelectField
            control={form.control}
            name="contractId"
            label={t(`${fields}.contract`)}
            placeholder={t("bookings.choose")}
            options={(contracts ?? []).map((c) => ({
              value: c.id,
              label: t("bookings.contractOption", {
                code: c.contractCode,
                package: c.packageName,
                remaining: c.remainingSessions,
              }),
            }))}
          />
        )}
        <SelectField
          control={form.control}
          name="trainerId"
          label={t(`${fields}.trainer`)}
          placeholder={t("bookings.choose")}
          options={trainerOptions}
        />
        <TextField
          control={form.control}
          name="date"
          label={t(`${fields}.date`)}
          placeholder={t("bookings.datePlaceholder")}
          inputMode="numeric"
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            control={form.control}
            name="startTime"
            label={t(`${fields}.startTime`)}
            placeholder={t("bookings.timePlaceholder")}
            inputMode="numeric"
          />
          <TextField
            control={form.control}
            name="endTime"
            label={t(`${fields}.endTime`)}
            placeholder={t("bookings.timePlaceholder")}
            inputMode="numeric"
          />
        </div>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A choice made before the form opened: shown, not editable. */
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <Field>
      <FieldLabel asChild>
        <span>{label}</span>
      </FieldLabel>
      <p className="text-sm">{value}</p>
    </Field>
  );
}

export type BookableContract = { id: string; contractCode: string; packageName: string; remainingSessions: number };

/** The customer's active contracts with sessions left (BR-003), or null while loading. */
export function useBookableContracts(customerId: string): BookableContract[] | null {
  const [state, setState] = useState<{ customerId: string; contracts: BookableContract[] } | null>(null);

  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/v1/customers/${customerId}/contracts?pageSize=100`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const { items } = (await response.json()) as { items: (BookableContract & { status: string })[] };
        setState({ customerId, contracts: items.filter((c) => c.status === "ACTIVE" && c.remainingSessions > 0) });
      } catch {
        // Aborted by a newer customer; nothing to do.
      }
    })();
    return () => controller.abort();
  }, [customerId]);

  return state?.customerId === customerId ? state.contracts : null;
}

/** Search a customer by code, name, or phone and pick one (FR-CUS-002). */
export function CustomerPicker<T extends FieldValues & { customerId: string }>({
  control,
  onPicked,
}: {
  control: Control<T>;
  onPicked: () => void;
}) {
  const t = useTranslations("bookings");
  const validationMessage = useValidationMessage();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<CustomerSearchResult | null>(null);
  const results = useCustomerSearch(query, 6);
  const tooShort = query.trim().length < MIN_CUSTOMER_QUERY_LENGTH;

  return (
    <Controller
      control={control}
      name={"customerId" as Path<T>}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          {/* cmdk names its input with its own `label`; this one is the visible label. */}
          <FieldLabel asChild>
            <span>{t("fields.customer")}</span>
          </FieldLabel>
          {picked && field.value ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="truncate">
                <span className="font-mono text-xs text-muted-foreground">{picked.customerCode}</span> {picked.fullName}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  field.onChange("");
                  setPicked(null);
                  onPicked();
                }}
              >
                {t("changeCustomer")}
              </Button>
            </div>
          ) : (
            // Enter picks the highlighted customer; it must not submit the form.
            <div onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}>
              <Command shouldFilter={false} label={t("fields.customer")} className="rounded-lg border">
                <CommandInput
                  placeholder={t("customerSearchPlaceholder")}
                  value={query}
                  onValueChange={setQuery}
                  aria-invalid={fieldState.invalid}
                />
                <CommandList className="max-h-48">
                  {tooShort ? (
                    <p className="py-3 text-center text-sm text-muted-foreground">{t("customerSearchHint")}</p>
                  ) : (
                    <CommandEmpty>{t("customerSearchEmpty")}</CommandEmpty>
                  )}
                  {results.map((customer) => (
                    <CommandItem
                      key={customer.id}
                      value={customer.id}
                      onSelect={() => {
                        field.onChange(customer.id);
                        setPicked(customer);
                        setQuery("");
                        onPicked();
                      }}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{customer.customerCode}</span>
                      <span className="truncate">{customer.fullName}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{customer.phone}</span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </div>
          )}
          {fieldState.error?.message && <FieldError>{validationMessage(fieldState.error.message)}</FieldError>}
        </Field>
      )}
    />
  );
}
