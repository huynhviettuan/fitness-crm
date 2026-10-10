"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PencilIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { notify } from "@/components/notify";
import { formatDateOnly } from "@/lib/format";
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
};

/** "Add customer": a short form, so it opens in a Sheet (docs/23 §7). */
export function CreateCustomerButton({ branches }: { branches: { id: string; name: string }[] }) {
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
  maskedFields: ("phone" | "email")[];
  email: string | null;
  dateOfBirth: Date | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE";
};

export function EditCustomerButton({ customer }: { customer: EditableCustomer }) {
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
          masked={customer.maskedFields}
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
