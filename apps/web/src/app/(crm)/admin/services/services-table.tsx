"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PackageIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import type { Service } from "@flow/shared/services";
import { ServiceDialog } from "./service-dialog";

type Branch = { id: string; name: string };

export function CreateServiceButton({ branches }: { branches: Branch[] }) {
  const t = useTranslations("services");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("create")}
      </Button>
      {open && <ServiceDialog service={null} branches={branches} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Every service, the inactive ones too; a row opens its price list (FR-SVC-001). */
export function ServicesTable({ services }: { services: Service[] }) {
  const t = useTranslations("services");

  const columns: DataTableColumn<Service>[] = [
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => (
        <Link href={`/admin/services/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { id: "kind", header: t("fields.kind"), cell: ({ row }) => t(`kinds.${row.original.kind}`) },
    {
      id: "branches",
      header: t("fields.branches"),
      cell: ({ row }) => row.original.branches.map((branch) => branch.name).join(", "),
    },
    {
      id: "hours",
      header: t("fields.hours"),
      cell: ({ row }) =>
        row.original.allowedFrom ? `${row.original.allowedFrom} - ${row.original.allowedTo}` : t("allDay"),
    },
    {
      id: "currentVersion",
      header: t("fields.currentVersion"),
      cell: ({ row }) =>
        row.original.currentVersion === null ? (
          <span className="text-muted-foreground">{t("noVersion")}</span>
        ) : (
          t("version", { version: row.original.currentVersion })
        ),
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="option" status={row.original.active ? "ACTIVE" : "INACTIVE"} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={services}
      label={t("title")}
      empty={<EmptyState icon={PackageIcon} title={t("empty")} />}
      getRowId={(row) => row.id}
    />
  );
}
