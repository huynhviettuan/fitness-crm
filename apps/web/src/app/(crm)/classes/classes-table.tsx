"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import type { GymClass } from "@flow/shared/classes";
import type { TrainerOption } from "../bookings/booking-types";
import { ClassFormButton, WeekdayBadges } from "./class-form";

type Props = {
  classes: GymClass[];
  canManage: boolean;
  trainers: TrainerOption[];
  branches: { id: string; name: string }[];
  branchOf: Record<string, string>;
};

/** The class definitions: a weekly slot each (brief §6.4). */
export function ClassesTable({ classes, canManage, trainers, branches, branchOf }: Props) {
  const t = useTranslations("classes");
  const columns: DataTableColumn<GymClass>[] = [
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    { id: "coach", header: t("fields.coach"), cell: ({ row }) => row.original.coach.fullName },
    { id: "days", header: t("fields.weekdays"), cell: ({ row }) => <WeekdayBadges weekdays={row.original.weekdays} /> },
    {
      id: "time",
      header: t("fields.time"),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.startTime}–{row.original.endTime}
        </span>
      ),
    },
    { id: "capacity", header: t("fields.capacity"), cell: ({ row }) => row.original.capacity },
    {
      id: "active",
      header: t("fields.status"),
      cell: ({ row }) => (
        <Badge variant={row.original.active ? "success" : "muted"}>{t(row.original.active ? "on" : "off")}</Badge>
      ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">{t("actions")}</span>,
            cell: ({ row }: { row: { original: GymClass } }) => (
              <ClassFormButton gymClass={row.original} trainers={trainers} branches={branches} branchOf={branchOf} />
            ),
          } satisfies DataTableColumn<GymClass>,
        ]
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      data={classes}
      label={t("manageLabel")}
      empty={<p className="p-6 text-center text-sm text-muted-foreground">{t("noClassesDefined")}</p>}
      getRowId={(row) => row.id}
    />
  );
}
