"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { KeyRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";

type RoleRow = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
};

export function RolesTable({ roles }: { roles: RoleRow[] }) {
  const t = useTranslations("roles");

  const columns: DataTableColumn<RoleRow>[] = [
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <Link href={`/admin/roles/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
          {row.original.code && <Badge variant="outline">{t("default")}</Badge>}
        </span>
      ),
    },
    {
      id: "description",
      header: t("fields.description"),
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.description}</span>,
    },
    { id: "permissions", header: t("fields.permissions"), cell: ({ row }) => row.original.permissions.length },
    { id: "users", header: t("fields.users"), cell: ({ row }) => t("users", { count: row.original.userCount }) },
  ];

  return (
    <DataTable
      columns={columns}
      data={roles}
      label={t("title")}
      empty={<EmptyState icon={KeyRoundIcon} title={t("emptyTitle")} />}
      getRowId={(row) => row.id}
    />
  );
}
