import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/date-time";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePageUser } from "@/lib/auth/current-user";
import { isApiError } from "@/lib/api/errors";
import { can } from "@/lib/permissions";
import { getTask, getTaskAssignees } from "@/lib/api/tasks";
import { formatReminderHours } from "@flow/shared/tasks";
import { EditTaskButton } from "../task-form";
import { TaskComments, TaskMoves } from "./task-panel";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

async function loadTask(id: string) {
  try {
    return await getTask(id);
  } catch (error) {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/tasks/[id]">): Promise<Metadata> {
  const user = await requirePageUser();
  if (!can(user, "task.view")) return {};
  return { title: (await loadTask((await params).id)).title };
}

/** One task: what, who, by when, the moves the user may make, and the discussion. */
export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const user = await requirePageUser();
  if (!can(user, "task.view")) return <ForbiddenState />;

  const t = await getTranslations("tasks");
  const task = await loadTask((await params).id);
  const assignees = await getTaskAssignees();
  const departmentName = task.department
    ? user.locale === "vi"
      ? task.department.labelVi
      : task.department.labelEn
    : null;
  const entityHref = task.entity
    ? `/${{ lead: "leads", customer: "customers", contract: "contracts", workoutLog: "workouts/logs" }[task.entity.type]}/${task.entity.id}`
    : null;

  const details: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.status"), value: <StatusBadge entity="task" status={task.status} /> },
    { label: t("fields.priority"), value: <StatusBadge entity="taskPriority" status={task.priority} /> },
    {
      label: t("fields.dueAt"),
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <DateTime value={task.dueAt} format="dateTime" />
          {task.overdue && <Badge variant="destructive">{t("overdue")}</Badge>}
        </span>
      ),
    },
    {
      label: t("fields.assignee"),
      value: task.assignee?.name ?? <span className="text-muted-foreground">{t("waitingInDepartment")}</span>,
    },
    { label: t("fields.department"), value: departmentName },
    {
      label: t("fields.reminders"),
      value: `${formatReminderHours(task.reminders)} ${t("remindersUnit")}${task.reminderMinutes ? "" : ` · ${t("remindersShared")}`}`,
    },
    { label: t("fields.assigner"), value: task.assigner.name },
    { label: t("fields.createdAt"), value: <DateTime value={task.createdAt} format="dateTime" /> },
    { label: t("fields.branch"), value: task.branch.name },
    {
      label: t("fields.entity"),
      value: task.entity && entityHref && (
        <Link href={entityHref} className="underline-offset-4 hover:underline">
          {t(`entityTypes.${task.entity.type}`)}: {task.entity.label}
        </Link>
      ),
    },
  ];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/tasks">
          <ArrowLeftIcon />
          {t("backToList")}
        </Link>
      </Button>
      <PageHeader
        title={task.title}
        actions={task.actions.includes("edit") && <EditTaskButton task={task} assignees={assignees} />}
      />
      <div className="mb-6">
        <TaskMoves task={task} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card role="region" aria-label={t("details")}>
          <CardContent className="pt-6">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
              {details.map((item) => (
                <div key={item.label} className="contents">
                  <dt className="text-sm text-muted-foreground">{item.label}</dt>
                  <dd className="text-sm break-words">{item.value ?? "—"}</dd>
                </div>
              ))}
            </dl>
            {task.description && (
              <p className="mt-4 border-t pt-4 text-sm break-words whitespace-pre-line">{task.description}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("comments")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TaskComments task={task} people={assignees.users.filter((person) => person.id !== user.id)} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
