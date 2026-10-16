"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ListPlusIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { formatDateOnly, formatTime } from "@/lib/format";
import {
  TASK_PRIORITIES,
  formatReminderHours,
  type TaskAssignees,
  type TaskDetail,
  type TaskEntityType,
} from "@gymcrm/shared/tasks";
import { calendarDate, calendarDateInTimeZone, timeOfDay } from "@gymcrm/shared/validation";
import { createTaskAction, updateTaskAction } from "./actions";

type BranchOption = { id: string; name: string };
/** The record a new task is about, when it is given from that record's page. */
export type TaskAbout = { type: TaskEntityType; id: string; label: string };

const PERSON = "person";
const DEPARTMENT = "department";
// The form keeps both choices; only the one picked is checked and sent. The API checks everything again.
const formSchema = z
  .object({
    branchId: z.string(),
    title: z.string().trim().min(1, { error: "required" }).max(200, { error: "tooLong" }),
    description: z.string().max(4000, { error: "tooLong" }),
    assignTo: z.enum([PERSON, DEPARTMENT]),
    assigneeUserId: z.string(),
    assigneeDepartmentId: z.string(),
    dueDate: calendarDate,
    dueTime: timeOfDay,
    priority: z.enum(TASK_PRIORITIES),
    reminders: z.string(),
  })
  .superRefine((value, ctx) => {
    const field = value.assignTo === PERSON ? "assigneeUserId" : "assigneeDepartmentId";
    if (!value[field]) ctx.addIssue({ code: "custom", path: [field], message: "required" });
  });

type FormValues = {
  branchId: string;
  title: string;
  description: string;
  assignTo: typeof PERSON | typeof DEPARTMENT;
  assigneeUserId: string;
  assigneeDepartmentId: string;
  dueDate: string;
  dueTime: string;
  priority: (typeof TASK_PRIORITIES)[number];
  reminders: string;
};

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignees: TaskAssignees;
  branches: BranchOption[];
  /** null to give a new task. */
  task: TaskDetail | null;
  about?: TaskAbout;
};

export function CreateTaskButton({
  assignees,
  branches,
  about,
}: {
  assignees: TaskAssignees;
  branches: BranchOption[];
  about?: TaskAbout;
}) {
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={about ? "outline" : "default"} onClick={() => setOpen(true)}>
        <ListPlusIcon />
        {t("create")}
      </Button>
      <TaskDialog
        open={open}
        onOpenChange={setOpen}
        assignees={assignees}
        branches={branches}
        task={null}
        about={about}
      />
    </>
  );
}

export function EditTaskButton({ task, assignees }: { task: TaskDetail; assignees: TaskAssignees }) {
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t("edit")}
      </Button>
      <TaskDialog open={open} onOpenChange={setOpen} assignees={assignees} branches={[]} task={task} />
    </>
  );
}

function TaskDialog({ open, onOpenChange, assignees, branches, task, about }: DialogProps) {
  const t = useTranslations("tasks");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? t("edit") : t("create")}</DialogTitle>
          <DialogDescription>
            {task ? t("editDescription") : about ? t("createAbout", { label: about.label }) : t("createDescription")}
          </DialogDescription>
        </DialogHeader>
        <TaskForm
          key={task?.id ?? "new"}
          assignees={assignees}
          branches={branches}
          task={task}
          about={about}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  assignees,
  branches,
  task,
  about,
  onDone,
}: Omit<DialogProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations();
  const f = useTranslations("tasks.fields");
  const locale = useLocale();
  const timeZone = useTimeZone() ?? "UTC";
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema, undefined, { raw: true }) as never,
    defaultValues: {
      branchId: "",
      title: task?.title ?? "",
      description: task?.description ?? "",
      assignTo: task?.department && !task.assignee ? DEPARTMENT : PERSON,
      assigneeUserId: task?.assignee?.id ?? "",
      assigneeDepartmentId: task?.department?.id ?? "",
      dueDate: task ? formatDateOnly(calendarDateInTimeZone(timeZone, task.dueAt)) : "",
      dueTime: task ? formatTime(task.dueAt, timeZone) : "17:00",
      priority: task?.priority ?? "NORMAL",
      reminders: task?.reminderMinutes ? formatReminderHours(task.reminderMinutes) : "",
    },
  });
  const assignTo = useWatch({ control: form.control, name: "assignTo" });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const { assignTo: kind, branchId, ...rest } = values;
      const fields = {
        ...rest,
        assigneeUserId: kind === PERSON ? values.assigneeUserId : "",
        assigneeDepartmentId: kind === DEPARTMENT ? values.assigneeDepartmentId : "",
      };
      const result = task
        ? await updateTaskAction(task.id, fields)
        : await createTaskAction({ ...fields, branchId, entityType: about?.type ?? "", entityId: about?.id ?? "" });
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        return void notify.error(errorMessage(result.code));
      }
      notify.success(task ? t("tasks.updated") : t("tasks.created"));
      onDone();
      if (!task && result.data && typeof result.data === "object" && "id" in result.data)
        router.push(`/tasks/${result.data.id}`);
      else router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FieldGroup>
        {!task && branches.length > 1 && (
          <SelectField
            control={form.control}
            name="branchId"
            label={f("branch")}
            placeholder={t("common.chooseBranch")}
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
        )}
        <TextField control={form.control} name="title" label={f("title")} autoComplete="off" />
        <TextField control={form.control} name="description" label={f("description")} multiline />
        <SelectField
          control={form.control}
          name="assignTo"
          label={t("tasks.assignTo")}
          options={[
            { value: PERSON, label: t("tasks.assignToPerson") },
            { value: DEPARTMENT, label: t("tasks.assignToDepartment") },
          ]}
        />
        {assignTo === PERSON ? (
          <SelectField
            control={form.control}
            name="assigneeUserId"
            label={f("assignee")}
            options={assignees.users.map((user) => ({
              value: user.id,
              label: user.department
                ? `${user.name} · ${locale === "vi" ? user.department.labelVi : user.department.labelEn}`
                : user.name,
            }))}
          />
        ) : (
          <SelectField
            control={form.control}
            name="assigneeDepartmentId"
            label={f("department")}
            options={assignees.departments.map((department) => ({
              value: department.id,
              label: locale === "vi" ? department.labelVi : department.labelEn,
            }))}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="dueDate"
            label={f("dueDate")}
            placeholder={t("tasks.datePlaceholder")}
            autoComplete="off"
          />
          <TextField
            control={form.control}
            name="dueTime"
            label={f("dueTime")}
            placeholder={t("tasks.dueTimePlaceholder")}
            inputMode="numeric"
          />
        </div>
        <SelectField
          control={form.control}
          name="priority"
          label={f("priority")}
          options={TASK_PRIORITIES.map((priority) => ({
            value: priority,
            label: t(`status.taskPriority.${priority}`),
          }))}
        />
        <TextField
          control={form.control}
          name="reminders"
          label={f("reminders")}
          description={t("tasks.remindersHint")}
          placeholder={t("tasks.remindersPlaceholder")}
          autoComplete="off"
        />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
