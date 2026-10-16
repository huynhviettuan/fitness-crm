"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RotateCcwIcon, TrashIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { OptionSelect } from "@/components/option-select";
import type { ActionResult } from "@/lib/actions/result";
import { rejectSchema } from "@gymcrm/shared/approvals";
import { unapproveSchema } from "@gymcrm/shared/contracts";
import type { OptionListKey } from "@gymcrm/shared/options";
import { DeleteDialog } from "../finance/delete-dialog";
import { useSubmit } from "../admin/users/user-dialogs";
import { deleteContractAction, rejectContractAction, unapproveContractAction } from "./actions";

type ContractRef = { id: string; contractCode: string };

type ReasonDialogProps = {
  title: string;
  body: string;
  reasonLabel: string;
  confirmLabel: string;
  listKey: OptionListKey;
  schema: typeof rejectSchema;
  run: (input: { reasonId: string; reasonNote: string }) => Promise<ActionResult>;
  success: string;
  onClose: () => void;
};

/** A reason from an option list, then the action: rejecting a contract, sending it back to pending approval. */
export function ReasonDialog({
  title,
  body,
  reasonLabel,
  confirmLabel,
  listKey,
  schema,
  run,
  success,
  onClose,
}: ReasonDialogProps) {
  const t = useTranslations("common");
  const router = useRouter();
  const { pending, run: submit } = useSubmit();
  const form = useForm<{ reasonId: string; reasonNote: string }>({
    resolver: zodResolver(schema, undefined, { raw: true }) as never,
    defaultValues: { reasonId: "", reasonNote: "" },
  });
  const onSubmit = form.handleSubmit((values) =>
    submit(
      () => run(values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(success);
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
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
          <OptionSelect
            control={form.control}
            name="reasonId"
            noteName="reasonNote"
            listKey={listKey}
            label={reasonLabel}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The approver turns a pending contract down, with a reason (A-121). */
export function RejectContractButton({ contract }: { contract: ContractRef }) {
  const t = useTranslations("contracts");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <XIcon />
        {t("reject")}
      </Button>
      {open && (
        <ReasonDialog
          title={t("rejectTitle", { code: contract.contractCode })}
          body={t("rejectBody")}
          reasonLabel={t("rejectReason")}
          confirmLabel={t("reject")}
          listKey="rejectReasons"
          schema={rejectSchema}
          run={(input) => rejectContractAction(contract.id, input)}
          success={t("rejected", { code: contract.contractCode })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Admin sends an approved contract back to pending approval (A-124). */
export function UnapproveContractButton({ contract }: { contract: ContractRef }) {
  const t = useTranslations("contracts");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RotateCcwIcon />
        {t("unapprove")}
      </Button>
      {open && (
        <ReasonDialog
          title={t("unapproveTitle", { code: contract.contractCode })}
          body={t("unapproveBody")}
          reasonLabel={t("unapproveReason")}
          confirmLabel={t("unapprove")}
          listKey="unapproveReasons"
          schema={unapproveSchema}
          run={(input) => unapproveContractAction(contract.id, input)}
          success={t("unapproved", { code: contract.contractCode })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Admin deletes a contract to the trash (A-125); receipts and sessions are listed when they block it. */
export function DeleteContractButton({ contract }: { contract: ContractRef }) {
  const t = useTranslations("contracts");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <TrashIcon />
        {t("delete")}
      </Button>
      <DeleteDialog
        open={open}
        onOpenChange={setOpen}
        title={t("deleteTitle", { code: contract.contractCode })}
        description={t("deleteBody")}
        onDelete={(input) => deleteContractAction(contract.id, input)}
        onDeleted={() => {
          setOpen(false);
          router.push("/contracts");
          router.refresh();
        }}
      />
    </>
  );
}
