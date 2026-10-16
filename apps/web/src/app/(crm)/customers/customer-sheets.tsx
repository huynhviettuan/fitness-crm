"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PencilIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { notify } from "@/components/notify";
import { formatDateOnly } from "@/lib/format";
import { NO_OPTION } from "@/components/option-select";
import { CustomerForm, type CustomerFormValues } from "./customer-form";
import { createCustomerAction, updateCustomerAction } from "./actions";

const EMPTY: CustomerFormValues = {
  branchId: "",
  fullName: "",
  phone: "",
  email: "",
  dateOfBirth: "",
  notes: "",
  status: "ACTIVE",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  customerGroupId: NO_OPTION,
  customerGroupNote: "",
  staffInChargeId: NO_OPTION,
};

/** "Add customer": a short form, so it opens in a Sheet (docs/23 §7). */
export function CreateCustomerButton({
  branches,
  staff,
}: {
  branches: { id: string; name: string }[];
  staff: { id: string; name: string }[];
}) {
  const t = useTranslations("customers");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon />
        {t("create")}
      </Button>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("create")}</SheetTitle>
          <SheetDescription>{t("createDescription")}</SheetDescription>
        </SheetHeader>
        <CustomerForm
          mode="create"
          defaultValues={EMPTY}
          branches={branches}
          staff={staff}
          submit={createCustomerAction}
          onCancel={() => setOpen(false)}
          onSaved={(result) => {
            const { id, customerCode } = result as { id: string; customerCode: string };
            setOpen(false);
            notify.success(t("created", { code: customerCode }));
            router.push(`/customers/${id}`);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

type EditableCustomer = {
  id: string;
  fullName: string;
  phone: string | null;
  maskedFields: ("phone" | "email" | "address" | "idDocument" | "health")[];
  email: string | null;
  dateOfBirth: Date | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE";
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  customerGroup: { id: string; note: string | null } | null;
  staffInCharge: { id: string } | null;
};

export function EditCustomerButton({
  customer,
  staff,
}: {
  customer: EditableCustomer;
  staff: { id: string; name: string }[];
}) {
  const t = useTranslations("customers");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const defaultValues: CustomerFormValues = {
    branchId: "",
    fullName: customer.fullName,
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    dateOfBirth: customer.dateOfBirth ? formatDateOnly(customer.dateOfBirth) : "",
    notes: customer.notes ?? "",
    status: customer.status,
    address: customer.address ?? "",
    emergencyContactName: customer.emergencyContactName ?? "",
    emergencyContactPhone: customer.emergencyContactPhone ?? "",
    customerGroupId: customer.customerGroup?.id ?? NO_OPTION,
    customerGroupNote: customer.customerGroup?.note ?? "",
    staffInChargeId: customer.staffInCharge?.id ?? NO_OPTION,
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t("edit")}
      </Button>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("edit")}</SheetTitle>
          <SheetDescription>{customer.fullName}</SheetDescription>
        </SheetHeader>
        <CustomerForm
          mode="edit"
          defaultValues={defaultValues}
          masked={customer.maskedFields.filter(
            (field): field is "phone" | "email" | "address" =>
              field === "phone" || field === "email" || field === "address",
          )}
          staff={staff}
          submit={(values) => updateCustomerAction(customer.id, values)}
          onCancel={() => setOpen(false)}
          onSaved={(result) => {
            setOpen(false);
            // Name, phone, and email may wait for approval while the rest is saved (D-018).
            notify.success((result as { submitted: boolean }).submitted ? t("identitySubmitted") : t("updated"));
            router.refresh();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
