"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLinkIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { SelectField, SwitchField, TextField } from "@/components/form-fields";
import {
  areaInputSchema,
  equipmentInputSchema,
  exerciseInputSchema,
  stageInputSchema,
  type Area,
  type Equipment,
  type Exercise,
  type Stage,
} from "@flow/shared/workouts";
import { CatalogDialog } from "./catalog-dialog";
import { saveAreaAction, saveEquipmentAction, saveExerciseAction, saveStageAction } from "./actions";

// The four catalogs of the workout plans (M7.1, brief §7.1): a table each, and a dialog to add and edit.

const NONE = "none";

/** A resolver that reads the select's "none" as an empty choice, as the schema expects (a select cannot hold ""). */
function resolverWithNone<T extends Record<string, unknown>>(schema: unknown, field: keyof T) {
  return ((values: T, context: unknown, options: never) =>
    zodResolver(schema as never, undefined, { raw: true })(
      { ...values, [field]: values[field] === NONE ? "" : values[field] } as never,
      context as never,
      options,
    )) as never;
}

function Inactive() {
  const t = useTranslations("workoutCatalog");
  return <Badge variant="muted">{t("inactive")}</Badge>;
}

/** The add button and the dialog it opens, with the entry being edited when there is one. */
function useDialog<T>() {
  const [state, setState] = useState<{ entry: T | null } | null>(null);
  return {
    state,
    add: () => setState({ entry: null }),
    edit: (entry: T) => setState({ entry }),
    close: () => setState(null),
  };
}

function Toolbar({ canEdit, onAdd }: { canEdit: boolean; onAdd: () => void }) {
  const t = useTranslations("workoutCatalog");
  return canEdit ? (
    <div className="flex justify-end">
      <Button onClick={onAdd}>
        <PlusIcon />
        {t("add")}
      </Button>
    </div>
  ) : null;
}

function EditButton({ canEdit, name, onClick }: { canEdit: boolean; name: string; onClick: () => void }) {
  const t = useTranslations("workoutCatalog");
  if (!canEdit) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onClick} aria-label={t("rowActions", { name })}>
      <PencilIcon />
      {t("edit")}
    </Button>
  );
}

// ------------------------------------------------------------------------------------------------ equipment

type EquipmentValues = { code: string; name: string; notes: string; active: boolean };

export function EquipmentPanel({ items, canEdit }: { items: Equipment[]; canEdit: boolean }) {
  const t = useTranslations("workoutCatalog");
  const dialog = useDialog<Equipment>();
  const columns: DataTableColumn<Equipment>[] = [
    {
      id: "code",
      header: t("fields.code"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.name} {!row.original.active && <Inactive />}
        </span>
      ),
    },
    { id: "notes", header: t("fields.notes"), cell: ({ row }) => row.original.notes ?? "—" },
    { id: "exercises", header: t("fields.exercises"), cell: ({ row }) => row.original.exercises },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <EditButton canEdit={canEdit} name={row.original.name} onClick={() => dialog.edit(row.original)} />
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <Toolbar canEdit={canEdit} onAdd={dialog.add} />
      <DataTable
        columns={columns}
        data={items}
        label={t("tabs.equipment")}
        empty={<EmptyState title={t("empty")} />}
        getRowId={(row) => row.id}
      />
      {dialog.state && <EquipmentDialog entry={dialog.state.entry} onClose={dialog.close} />}
    </div>
  );
}

function EquipmentDialog({ entry, onClose }: { entry: Equipment | null; onClose: () => void }) {
  const t = useTranslations("workoutCatalog");
  const form = useForm<EquipmentValues>({
    resolver: zodResolver(equipmentInputSchema, undefined, { raw: true }) as never,
    defaultValues: {
      code: entry?.code ?? "",
      name: entry?.name ?? "",
      notes: entry?.notes ?? "",
      active: entry?.active ?? true,
    },
  });
  return (
    <CatalogDialog
      title={t(entry ? "titles.equipmentEdit" : "titles.equipmentAdd")}
      form={form}
      save={(values) => saveEquipmentAction(entry?.id ?? null, values)}
      onClose={onClose}
    >
      <TextField control={form.control} name="code" label={t("fields.code")} autoComplete="off" />
      <TextField control={form.control} name="name" label={t("fields.name")} autoComplete="off" />
      <TextField control={form.control} name="notes" label={t("fields.notes")} multiline />
      <SwitchField control={form.control} name="active" label={t("fields.active")} />
    </CatalogDialog>
  );
}

// ---------------------------------------------------------------------------------------------------- areas

type AreaValues = { code: string; name: string; parentId: string; notes: string; active: boolean };

export function AreasPanel({ items, canEdit }: { items: Area[]; canEdit: boolean }) {
  const t = useTranslations("workoutCatalog");
  const dialog = useDialog<Area>();
  const columns: DataTableColumn<Area>[] = [
    {
      id: "code",
      header: t("fields.code"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => (
        <span className="font-medium" style={{ paddingInlineStart: `${(row.original.depth - 1) * 1.25}rem` }}>
          {row.original.depth > 1 && <span aria-hidden>└ </span>}
          {row.original.name} {!row.original.active && <Inactive />}
        </span>
      ),
    },
    { id: "notes", header: t("fields.notes"), cell: ({ row }) => row.original.notes ?? "—" },
    { id: "exercises", header: t("fields.exercises"), cell: ({ row }) => row.original.exercises },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <EditButton canEdit={canEdit} name={row.original.name} onClick={() => dialog.edit(row.original)} />
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <Toolbar canEdit={canEdit} onAdd={dialog.add} />
      <DataTable
        columns={columns}
        data={items}
        label={t("tabs.areas")}
        empty={<EmptyState title={t("empty")} />}
        getRowId={(row) => row.id}
      />
      {dialog.state && <AreaDialog entry={dialog.state.entry} areas={items} onClose={dialog.close} />}
    </div>
  );
}

function AreaDialog({ entry, areas, onClose }: { entry: Area | null; areas: Area[]; onClose: () => void }) {
  const t = useTranslations("workoutCatalog");
  const form = useForm<AreaValues>({
    resolver: resolverWithNone<AreaValues>(areaInputSchema, "parentId"),
    defaultValues: {
      code: entry?.code ?? "",
      name: entry?.name ?? "",
      parentId: entry?.parentId ?? NONE,
      notes: entry?.notes ?? "",
      active: entry?.active ?? true,
    },
  });
  // The API refuses an area under itself or what is below it; the list only leaves out the area itself.
  const parents = areas.filter((area) => area.id !== entry?.id);
  return (
    <CatalogDialog
      title={t(entry ? "titles.areaEdit" : "titles.areaAdd")}
      form={form}
      save={(values) =>
        saveAreaAction(entry?.id ?? null, { ...values, parentId: values.parentId === NONE ? "" : values.parentId })
      }
      onClose={onClose}
    >
      <TextField control={form.control} name="code" label={t("fields.code")} autoComplete="off" />
      <TextField control={form.control} name="name" label={t("fields.name")} autoComplete="off" />
      <SelectField
        control={form.control}
        name="parentId"
        label={t("fields.parent")}
        options={[
          { value: NONE, label: t("noParent") },
          ...parents.map((area) => ({ value: area.id, label: area.path })),
        ]}
      />
      <TextField control={form.control} name="notes" label={t("fields.notes")} multiline />
      <SwitchField control={form.control} name="active" label={t("fields.active")} />
    </CatalogDialog>
  );
}

// ------------------------------------------------------------------------------------------------ exercises

type ExerciseValues = {
  name: string;
  areaId: string;
  equipmentId: string;
  kind: string;
  description: string;
  videoUrl: string;
  active: boolean;
};

export function ExercisesPanel({
  items,
  areas,
  equipment,
  canEdit,
}: {
  items: Exercise[];
  areas: Area[];
  equipment: Equipment[];
  canEdit: boolean;
}) {
  const t = useTranslations("workoutCatalog");
  const dialog = useDialog<Exercise>();
  const columns: DataTableColumn<Exercise>[] = [
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.name} {!row.original.active && <Inactive />}
        </span>
      ),
    },
    {
      id: "kind",
      header: t("fields.kind"),
      cell: ({ row }) => (
        <Badge variant={row.original.kind === "CARDIO" ? "info" : "outline"}>{t(`kinds.${row.original.kind}`)}</Badge>
      ),
    },
    { id: "area", header: t("fields.area"), cell: ({ row }) => row.original.area.path },
    { id: "equipment", header: t("fields.equipment"), cell: ({ row }) => row.original.equipment?.name ?? "—" },
    {
      id: "video",
      header: t("fields.videoUrl"),
      cell: ({ row }) =>
        row.original.videoUrl ? (
          <a
            href={row.original.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
          >
            <ExternalLinkIcon className="size-3.5" />
            {t("videoOpen")}
          </a>
        ) : (
          "—"
        ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <EditButton canEdit={canEdit} name={row.original.name} onClick={() => dialog.edit(row.original)} />
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <Toolbar canEdit={canEdit} onAdd={dialog.add} />
      <DataTable
        columns={columns}
        data={items}
        label={t("tabs.exercises")}
        empty={<EmptyState title={t("empty")} />}
        getRowId={(row) => row.id}
      />
      {dialog.state && (
        <ExerciseDialog entry={dialog.state.entry} areas={areas} equipment={equipment} onClose={dialog.close} />
      )}
    </div>
  );
}

function ExerciseDialog({
  entry,
  areas,
  equipment,
  onClose,
}: {
  entry: Exercise | null;
  areas: Area[];
  equipment: Equipment[];
  onClose: () => void;
}) {
  const t = useTranslations("workoutCatalog");
  const form = useForm<ExerciseValues>({
    resolver: resolverWithNone<ExerciseValues>(exerciseInputSchema, "equipmentId"),
    defaultValues: {
      name: entry?.name ?? "",
      areaId: entry?.area.id ?? "",
      equipmentId: entry?.equipment?.id ?? NONE,
      kind: entry?.kind ?? "STRENGTH",
      description: entry?.description ?? "",
      videoUrl: entry?.videoUrl ?? "",
      active: entry?.active ?? true,
    },
  });
  return (
    <CatalogDialog
      title={t(entry ? "titles.exerciseEdit" : "titles.exerciseAdd")}
      form={form}
      save={(values) =>
        saveExerciseAction(entry?.id ?? null, {
          ...values,
          kind: values.kind as "STRENGTH" | "CARDIO",
          equipmentId: values.equipmentId === NONE ? "" : values.equipmentId,
        })
      }
      onClose={onClose}
    >
      <TextField control={form.control} name="name" label={t("fields.name")} autoComplete="off" />
      <SelectField
        control={form.control}
        name="kind"
        label={t("fields.kind")}
        options={(["STRENGTH", "CARDIO"] as const).map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))}
      />
      <SelectField
        control={form.control}
        name="areaId"
        label={t("fields.area")}
        options={areas.map((area) => ({ value: area.id, label: area.path }))}
      />
      <SelectField
        control={form.control}
        name="equipmentId"
        label={t("fields.equipment")}
        options={[
          { value: NONE, label: t("noEquipment") },
          ...equipment.map((item) => ({ value: item.id, label: item.name })),
        ]}
      />
      <TextField control={form.control} name="description" label={t("fields.description")} multiline />
      <TextField
        control={form.control}
        name="videoUrl"
        label={t("fields.videoUrl")}
        placeholder="https://"
        inputMode="url"
      />
      <SwitchField control={form.control} name="active" label={t("fields.active")} />
    </CatalogDialog>
  );
}

// ---------------------------------------------------------------------------------------------------- stages

type StageValues = { name: string; description: string; active: boolean };

export function StagesPanel({ items, canEdit }: { items: Stage[]; canEdit: boolean }) {
  const t = useTranslations("workoutCatalog");
  const dialog = useDialog<Stage>();
  const columns: DataTableColumn<Stage>[] = [
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.name} {!row.original.active && <Inactive />}
        </span>
      ),
    },
    { id: "description", header: t("fields.description"), cell: ({ row }) => row.original.description ?? "—" },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("edit")}</span>,
      cell: ({ row }) => (
        <EditButton canEdit={canEdit} name={row.original.name} onClick={() => dialog.edit(row.original)} />
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <Toolbar canEdit={canEdit} onAdd={dialog.add} />
      <DataTable
        columns={columns}
        data={items}
        label={t("tabs.stages")}
        empty={<EmptyState title={t("empty")} />}
        getRowId={(row) => row.id}
      />
      {dialog.state && <StageDialog entry={dialog.state.entry} onClose={dialog.close} />}
    </div>
  );
}

function StageDialog({ entry, onClose }: { entry: Stage | null; onClose: () => void }) {
  const t = useTranslations("workoutCatalog");
  const form = useForm<StageValues>({
    resolver: zodResolver(stageInputSchema, undefined, { raw: true }) as never,
    defaultValues: { name: entry?.name ?? "", description: entry?.description ?? "", active: entry?.active ?? true },
  });
  return (
    <CatalogDialog
      title={t(entry ? "titles.stageEdit" : "titles.stageAdd")}
      form={form}
      save={(values) => saveStageAction(entry?.id ?? null, values)}
      onClose={onClose}
    >
      <TextField control={form.control} name="name" label={t("fields.name")} autoComplete="off" />
      <TextField control={form.control} name="description" label={t("fields.description")} multiline />
      <SwitchField control={form.control} name="active" label={t("fields.active")} />
    </CatalogDialog>
  );
}
