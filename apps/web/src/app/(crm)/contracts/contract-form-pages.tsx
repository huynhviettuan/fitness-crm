"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { notify } from "@/components/notify";
import { createContractAction, updateContractAction } from "./actions";
import { ContractForm, EMPTY_CONTRACT, type ContractFormValues } from "./contract-form";
import type { Companion } from "./companion-picker";

type Shared = Omit<
  React.ComponentProps<typeof ContractForm>,
  | "defaultValues"
  | "defaultCompanions"
  | "withFirstPayment"
  | "voucherName"
  | "submit"
  | "onSaved"
  | "submitLabel"
  | "cancelHref"
>;

/** A new contract for one customer. The key is made when the page opens, so a double submit reuses it (T-015). */
export function NewContractForm(props: Shared) {
  const t = useTranslations("contracts");
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  return (
    <ContractForm
      {...props}
      defaultValues={EMPTY_CONTRACT}
      defaultCompanions={[]}
      withFirstPayment
      submitLabel={t("form.submit")}
      cancelHref={`/customers/${props.customer.id}`}
      submit={(input) => createContractAction(props.customer.id, input, idempotencyKey)}
      onSaved={(result) => {
        const { id, contractCode } = result as { id: string; contractCode: string };
        notify.success(t("created", { code: contractCode }));
        router.push(`/contracts/${id}`);
      }}
    />
  );
}

/** A draft contract changed; the price is worked out again from the same inputs (OQ-015 interim). */
export function EditContractForm({
  contractId,
  defaultValues,
  defaultCompanions,
  ...props
}: Shared & {
  contractId: string;
  defaultValues: ContractFormValues;
  defaultCompanions: Companion[];
  voucherName: string | null;
}) {
  const t = useTranslations("contracts");
  const router = useRouter();
  return (
    <ContractForm
      {...props}
      defaultValues={defaultValues}
      defaultCompanions={defaultCompanions}
      withFirstPayment={false}
      submitLabel={t("form.save")}
      cancelHref={`/contracts/${contractId}`}
      submit={(input) => updateContractAction(contractId, input)}
      onSaved={() => {
        notify.success(t("updated"));
        router.push(`/contracts/${contractId}`);
        router.refresh();
      }}
    />
  );
}
