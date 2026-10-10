"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** States the effect of the action before the user confirms. */
  description: string;
  confirmLabel: string;
  /** Label of the button that closes the dialog; "Cancel" by default. */
  dismissLabel?: string;
  destructive?: boolean;
  /** Details shown under the description, e.g. the records the action affects. */
  children?: React.ReactNode;
  /** Return false to keep the dialog open (e.g. when the action failed). */
  onConfirm: () => Promise<boolean | void>;
};

/** Confirmation for every critical action (docs/23 §7). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  dismissLabel,
  destructive,
  children,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();

  const confirm = (event: React.MouseEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const keepOpen = (await onConfirm()) === false;
      if (!keepOpen) onOpenChange(false);
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{dismissLabel ?? t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={confirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
