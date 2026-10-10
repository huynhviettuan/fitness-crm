"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import type { AuditEvent } from "@flow/shared/audit";

/** Changes newest first, each with its values before and after (FR-PLT-008). */
export function AuditTable({ events, empty, footer }: { events: AuditEvent[]; empty: ReactNode; footer?: ReactNode }) {
  const t = useTranslations("audit");

  const columns: DataTableColumn<AuditEvent>[] = [
    { id: "at", header: t("fields.at"), cell: ({ row }) => <DateTime value={row.original.at} format="dateTime" /> },
    { id: "actor", header: t("fields.actor"), cell: ({ row }) => row.original.actor?.name ?? t("system") },
    { id: "action", header: t("fields.action"), cell: ({ row }) => <ActionLabel event={row.original} /> },
    {
      id: "record",
      header: t("fields.record"),
      cell: ({ row }) => (
        <Link
          href={`/admin/audit?record=${row.original.entityId}`}
          className="font-mono text-xs hover:underline"
          title={t("copyId")}
          aria-label={`${t("copyId")}: ${row.original.entityId}`}
        >
          {row.original.entityId.slice(0, 8)}
        </Link>
      ),
    },
    { id: "changes", header: t("fields.changes"), cell: ({ row }) => <Changes event={row.original} /> },
  ];

  return <DataTable columns={columns} data={events} label={t("title")} empty={empty} footer={footer} getRowId={(row) => row.id} />;
}

/** "Receipt · Deleted": the kind of record and what happened, in the user's language. */
function ActionLabel({ event }: { event: AuditEvent }) {
  const t = useTranslations("audit");
  const verb = event.action.slice(event.action.indexOf(".") + 1);
  const entityKey = `entities.${event.entityType}`;
  const verbKey = `verbs.${verb}`;
  const entity = t.has(entityKey as Parameters<typeof t.has>[0]) ? t(entityKey as Parameters<typeof t>[0]) : event.entityType;
  const action = t.has(verbKey as Parameters<typeof t.has>[0]) ? t(verbKey as Parameters<typeof t>[0]) : verb;
  return (
    <span className="whitespace-nowrap">
      {entity} · <span className="font-medium">{action}</span>
    </span>
  );
}

/** One line per field: its value before and after; then any details (e.g. the reason). */
function Changes({ event }: { event: AuditEvent }) {
  const t = useTranslations("audit");
  const before = event.before ?? {};
  const after = event.after ?? {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const context = Object.entries(event.context);
  if (fields.length === 0 && context.length === 0) return null;

  return (
    <div className="max-w-xl space-y-2 text-xs whitespace-normal">
      {fields.length > 0 && (
        <table className="w-full table-fixed border-collapse">
          <thead className="sr-only">
            <tr>
              <th>{t("field")}</th>
              <th>{t("before")}</th>
              <th>{t("after")}</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field} className="align-top">
                <th scope="row" className="w-32 py-0.5 pr-2 text-left font-mono font-normal text-muted-foreground">
                  {field}
                </th>
                <td className="py-0.5 pr-2 break-words text-muted-foreground line-through decoration-muted-foreground/50">
                  {event.before ? show(before[field]) : null}
                </td>
                <td className="py-0.5 break-words">{event.after ? show(after[field]) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {context.length > 0 && (
        <p className="text-muted-foreground">
          {t("context")}: {context.map(([key, value]) => `${key}: ${show(value)}`).join("; ")}
        </p>
      )}
    </div>
  );
}

/** A stored value as text: strings as they are, anything else as compact JSON. */
function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}
