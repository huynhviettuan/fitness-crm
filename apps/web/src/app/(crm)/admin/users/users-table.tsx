"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MoreHorizontalIcon, UserPlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { notify } from "@/components/notify";
import { StatusBadge } from "@/components/status-badge";
import { useErrorMessage } from "@/components/use-error-message";
import { setUserStatusAction } from "./actions";
import { CreateUserDialog, ResetPasswordDialog, type Option } from "./user-dialogs";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: { id: string; name: string };
  status: "ACTIVE" | "DISABLED";
  allBranches: boolean;
  branches: { id: string; name: string }[];
  createdAt: Date;
};

type OpenDialog = { kind: "password" | "disable"; user: UserRow } | null;

export function CreateUserButton({ roles, branches }: { roles: Option[]; branches: Option[] }) {
  const t = useTranslations("users");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon />
        {t("create")}
      </Button>
      <CreateUserDialog open={open} onOpenChange={setOpen} roles={roles} branches={branches} />
    </>
  );
}

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const setStatus = async (user: UserRow, status: UserRow["status"]) => {
    const result = await setUserStatusAction({ userId: user.id, status });
    if (!result.ok) {
      notify.error(errorMessage(result.code));
      return false;
    }
    notify.success(t(status === "DISABLED" ? "users.disabled" : "users.enabled", { name: user.name }));
    router.refresh();
  };

  const columns: DataTableColumn<UserRow>[] = [
    {
      id: "name",
      header: t("users.fields.name"),
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <Link href={`/admin/users/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
          {row.original.id === currentUserId && <Badge variant="outline">{t("users.you")}</Badge>}
        </span>
      ),
    },
    { id: "email", header: t("users.fields.email"), cell: ({ row }) => row.original.email },
    { id: "role", header: t("users.fields.role"), cell: ({ row }) => row.original.role.name },
    {
      id: "branches",
      header: t("users.fields.branches"),
      // D-014: every branch, or the granted ones.
      cell: ({ row }) =>
        row.original.allBranches ? t("users.allBranches") : row.original.branches.map((branch) => branch.name).join(", "),
    },
    {
      id: "status",
      header: t("users.fields.status"),
      cell: ({ row }) => <StatusBadge entity="user" status={row.original.status} />,
    },
    {
      id: "createdAt",
      header: t("users.fields.createdAt"),
      cell: ({ row }) => <DateTime value={row.original.createdAt} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: ({ row }) => {
        const user = row.original;
        // An admin cannot change their own access (CANNOT_CHANGE_OWN_ACCESS).
        if (user.id === currentUserId) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("users.rowActions", { name: user.name })}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/admin/users/${user.id}`}>{t("users.open")}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog({ kind: "password", user })}>
                {t("users.resetPassword")}
              </DropdownMenuItem>
              {user.status === "ACTIVE" ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: "disable", user })}>
                  {t("users.disable")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void setStatus(user, "ACTIVE")}>{t("users.enable")}</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const close = (open: boolean) => !open && setDialog(null);

  return (
    <>
      <DataTable columns={columns} data={users} label={t("users.title")} empty={null} getRowId={(row) => row.id} />
      {dialog?.kind === "password" && <ResetPasswordDialog open onOpenChange={close} user={dialog.user} />}
      {dialog?.kind === "disable" && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title={t("users.disableTitle", { name: dialog.user.name })}
          description={t("users.disableBody")}
          confirmLabel={t("users.disable")}
          destructive
          onConfirm={() => setStatus(dialog.user, "DISABLED")}
        />
      )}
    </>
  );
}
