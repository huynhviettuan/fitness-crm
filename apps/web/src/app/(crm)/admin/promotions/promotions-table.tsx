"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PencilIcon, PlusIcon, TicketPercentIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import type { Promotion } from "@gymcrm/shared/promotions";
import { PromotionDialog } from "./promotion-dialog";

type ServiceChoice = { id: string; name: string };

export function CreatePromotionButton({ services }: { services: ServiceChoice[] }) {
  const t = useTranslations("promotions");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("create")}
      </Button>
      {open && <PromotionDialog promotion={null} services={services} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Every promotion and voucher, the inactive ones too, with the voucher codes (Admin only). */
export function PromotionsTable({ promotions, services }: { promotions: Promotion[]; services: ServiceChoice[] }) {
  const t = useTranslations("promotions");
  const [editing, setEditing] = useState<Promotion | null>(null);

  const columns: DataTableColumn<Promotion>[] = [
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    { id: "kind", header: t("fields.kind"), cell: ({ row }) => t(`kinds.${row.original.kind}`) },
    {
      id: "code",
      header: t("fields.code"),
      cell: ({ row }) => (row.original.code ? <span className="font-mono">{row.original.code}</span> : "—"),
    },
    {
      id: "discount",
      header: t("fields.discount"),
      cell: ({ row }) =>
        row.original.discountType === "PERCENT" ? `${row.original.value}%` : <Money amount={row.original.value} />,
    },
    {
      id: "services",
      header: t("fields.services"),
      cell: ({ row }) =>
        row.original.services.length === 0 ? t("allServices") : row.original.services.map((s) => s.name).join(", "),
    },
    {
      id: "validity",
      header: t("fields.validity"),
      cell: ({ row }) => (
        <>
          {row.original.validFrom ? <DateTime value={row.original.validFrom} format="dateOnly" /> : "…"}
          {" - "}
          {row.original.validTo ? <DateTime value={row.original.validTo} format="dateOnly" /> : t("noEnd")}
        </>
      ),
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="option" status={row.original.active ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(row.original)}
          aria-label={t("rowActions", { name: row.original.name })}
        >
          <PencilIcon />
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={promotions}
        label={t("title")}
        empty={<EmptyState icon={TicketPercentIcon} title={t("empty")} />}
        getRowId={(row) => row.id}
      />
      {editing && <PromotionDialog promotion={editing} services={services} onClose={() => setEditing(null)} />}
    </>
  );
}
