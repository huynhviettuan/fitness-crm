"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AtSignIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateTime } from "@/components/date-time";
import { TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { taskCommentSchema, type TaskAction, type TaskDetail } from "@flow/shared/tasks";
import { addTaskCommentAction, moveTaskAction } from "../actions";

type Move = "accept" | "start" | "complete" | "cancel";
const MOVES: Move[] = ["accept", "start", "complete", "cancel"];

/** The moves the user may make now (the API sends them); cancelling asks first. */
export function TaskMoves({ task }: { task: TaskDetail }) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const available = MOVES.filter((move) => task.actions.includes(move as TaskAction));

  const run = async (move: Move): Promise<boolean> => {
    const result = await moveTaskAction(task.id, move);
    if (!result.ok) {
      notify.error(errorMessage(result.code));
      return false;
    }
    notify.success(t(`moved.${move}`));
    router.refresh();
    return true;
  };

  if (available.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {available.map((move) =>
        move === "cancel" ? (
          <Button key={move} variant="outline" disabled={pending} onClick={() => setConfirming(true)}>
            {t("actions.cancel")}
          </Button>
        ) : (
          <Button key={move} disabled={pending} onClick={() => startTransition(async () => void (await run(move)))}>
            {t(`actions.${move}`)}
          </Button>
        ),
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("cancelTitle")}
        description={t("cancelBody")}
        confirmLabel={t("actions.cancel")}
        dismissLabel={t("keep")}
        destructive
        onConfirm={() => run("cancel")}
      />
    </div>
  );
}

type CommentValues = { body: string; mentions: string[] };

/** The task's discussion (brief §8.2): comments, and naming people who should look. */
export function TaskComments({ task, people }: { task: TaskDetail; people: { id: string; name: string }[] }) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<CommentValues>({
    resolver: zodResolver(taskCommentSchema, undefined, { raw: true }) as never,
    defaultValues: { body: "", mentions: [] },
  });
  const mentions = useWatch({ control: form.control, name: "mentions" });
  const canComment = task.actions.includes("comment");

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await addTaskCommentAction(task.id, values);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        return void notify.error(errorMessage(result.code));
      }
      notify.success(t("commented"));
      form.reset({ body: "", mentions: [] });
      router.refresh();
    }),
  );

  const toggle = (id: string, on: boolean) =>
    form.setValue("mentions", on ? [...mentions, id] : mentions.filter((value) => value !== id), { shouldDirty: true });

  return (
    <div className="flex flex-col gap-4">
      {task.comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noComments")}</p>
      ) : (
        <ol aria-label={t("comments")} className="flex flex-col gap-3">
          {task.comments.map((comment) => (
            <li key={comment.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{comment.author.name}</span>
                <span className="text-xs text-muted-foreground">
                  <DateTime value={comment.createdAt} format="dateTime" />
                </span>
              </div>
              <p className="mt-1 text-sm break-words whitespace-pre-line">{comment.body}</p>
              {comment.mentions.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">{t("mentioned", { names: comment.mentions.map((person) => person.name).join(", ") })}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {canComment && (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <TextField control={form.control} name="body" label={t("comment")} placeholder={t("commentPlaceholder")} multiline />
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <AtSignIcon />
                  {mentions.length ? t("mentionCount", { count: mentions.length }) : t("mention")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                {people.map((person) => (
                  <DropdownMenuCheckboxItem
                    key={person.id}
                    checked={mentions.includes(person.id)}
                    onCheckedChange={(on) => toggle(person.id, on === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {person.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="submit" size="sm" disabled={pending}>
              <SendIcon />
              {t("send")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
