"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { useValidationMessage } from "@/components/form-fields";
import { normalizeForSearch } from "@flow/shared/validation";
import {
  PLAN_LIMITS,
  planContentSchema,
  type Exercise,
  type Plan,
  type PlanContentInput,
  type Stage,
} from "@flow/shared/workouts";
import { saveAndSubmitPlanAction, savePlanAction } from "../../actions";

// The editor of a draft plan or template (M7.2, brief §7.2): stages, their sessions, the exercises of a session from the
// catalog, and the targets of each set, which are Strength's or Cardio's by the exercise.

type SetState = Record<
  | "weight"
  | "reps"
  | "restSeconds"
  | "rir"
  | "tempo"
  | "technique"
  | "videoUrl"
  | "durationMinutes"
  | "speed"
  | "heartRate"
  | "notes",
  string
>;
type ItemState = { exerciseId: string; sets: SetState[] };
type SessionState = { week: string; number: string; goal: string; items: ItemState[] };
type StageState = { stageId: string; sessions: SessionState[] };
type State = { name: string; phase: string; goal: string; notes: string; active: boolean; stages: StageState[] };

const SET_FIELDS = [
  "weight",
  "reps",
  "restSeconds",
  "rir",
  "tempo",
  "technique",
  "videoUrl",
  "durationMinutes",
  "speed",
  "heartRate",
  "notes",
] as const;
const STRENGTH_COLUMNS = ["weight", "reps", "restSeconds", "rir", "tempo", "technique", "notes", "videoUrl"] as const;
const CARDIO_COLUMNS = ["durationMinutes", "speed", "heartRate", "notes"] as const;

const text = (value: number | string | null) => (value === null ? "" : String(value));
const emptySet = (): SetState => Object.fromEntries(SET_FIELDS.map((field) => [field, ""])) as SetState;

function setStateOf(set: Plan["stages"][number]["sessions"][number]["items"][number]["sets"][number]): SetState {
  return {
    weight: text(set.weight),
    reps: text(set.reps),
    restSeconds: text(set.restSeconds),
    rir: text(set.rir),
    tempo: text(set.tempo),
    technique: text(set.technique),
    videoUrl: text(set.videoUrl),
    durationMinutes: text(set.durationMinutes),
    speed: text(set.speed),
    heartRate: text(set.heartRate),
    notes: text(set.notes),
  };
}

function stateOf(plan: Plan): State {
  return {
    name: plan.name,
    phase: plan.phase ?? "",
    goal: plan.goal ?? "",
    notes: plan.notes ?? "",
    active: plan.active,
    stages: plan.stages.map((stage) => ({
      stageId: stage.stage.id,
      sessions: stage.sessions.map((session) => ({
        week: text(session.week),
        number: text(session.number),
        goal: session.goal ?? "",
        items: session.items.map((item) => ({
          exerciseId: item.exercise.id,
          sets: item.sets.map((set) => setStateOf(set)),
        })),
      })),
    })),
  };
}

type Problem = { where: string; code: string };

/** "stages.1.sessions.0.items.2.sets.0.speed" as the place in words: stage 2 · session 1 · exercise 3 · set 1 · speed. */
type Translate = (key: string, values?: Record<string, number>) => string;

function placeOf(path: string, t: Translate): string {
  const parts = path.split(".");
  const out: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const next = parts[index + 1];
    if (["stages", "sessions", "items", "sets"].includes(part) && next !== undefined && /^\d+$/.test(next)) {
      out.push(t(`place.${part}`, { n: Number(next) + 1 }));
      index += 1;
    } else if (!/^\d+$/.test(part)) {
      out.push(t(`place.${part}`));
    }
  }
  return out.join(" · ");
}

export function PlanEditor({
  plan,
  exercises,
  stages,
}: {
  plan: Plan;
  exercises: Exercise[];
  /** The catalog stages that can be picked (the active ones, and those the plan has). */
  stages: Pick<Stage, "id" | "name">[];
}) {
  const t = useTranslations("workoutPlans");
  const common = useTranslations("common");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const validationMessage = useValidationMessage();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>(() => stateOf(plan));
  const [problems, setProblems] = useState<Problem[]>([]);
  const [picking, setPicking] = useState<{ stage: number; session: number } | null>(null);
  const template = plan.kind === "TEMPLATE";
  const kindOf = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  const edit = (change: (draft: State) => void) =>
    setState((previous) => {
      const next = structuredClone(previous);
      change(next);
      return next;
    });

  const move = <T,>(list: T[], index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
  };

  const content = (): PlanContentInput => ({
    name: state.name,
    phase: state.phase,
    goal: state.goal,
    notes: state.notes,
    active: state.active,
    stages: state.stages,
  });

  /** The same checks as the API's schema, so a typo is shown before anything is sent. */
  const check = (): boolean => {
    const result = planContentSchema.safeParse(content());
    if (result.success) return true;
    setProblems(result.error.issues.map((issue) => ({ where: issue.path.join("."), code: issue.message })));
    return false;
  };

  const run = (action: "save" | "send") =>
    startTransition(async () => {
      setProblems([]);
      if (!check()) return;
      const result =
        action === "save"
          ? await savePlanAction(plan.id, content())
          : await saveAndSubmitPlanAction(plan.id, content());
      if (!result.ok) {
        setProblems(
          Object.entries(result.fieldErrors ?? {}).flatMap(([where, codes]) => codes.map((code) => ({ where, code }))),
        );
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(action === "save" ? t("saved") : t("sent"));
      router.refresh();
    });

  const addExercise = (exerciseId: string) => {
    if (!picking) return;
    const exercise = kindOf.get(exerciseId);
    edit((draft) => {
      draft.stages[picking.stage]!.sessions[picking.session]!.items.push({
        exerciseId,
        sets: exercise ? [emptySet()] : [],
      });
    });
    setPicking(null);
  };

  const label = (field: string) => t(`set.${field}` as never);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("header")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="plan-name">{t("fields.name")}</Label>
            <Input
              id="plan-name"
              value={state.name}
              onChange={(event) => edit((d) => void (d.name = event.target.value))}
            />
          </div>
          {!template && (
            <>
              <div className="space-y-2">
                <Label htmlFor="plan-phase">{t("fields.phase")}</Label>
                <Input
                  id="plan-phase"
                  value={state.phase}
                  onChange={(event) => edit((d) => void (d.phase = event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-goal">{t("fields.goal")}</Label>
                <Input
                  id="plan-goal"
                  value={state.goal}
                  onChange={(event) => edit((d) => void (d.goal = event.target.value))}
                />
              </div>
            </>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="plan-notes">{t("fields.notes")}</Label>
            <Textarea
              id="plan-notes"
              value={state.notes}
              onChange={(event) => edit((d) => void (d.notes = event.target.value))}
            />
          </div>
          {template && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                id="plan-active"
                checked={state.active}
                onCheckedChange={(value) => edit((d) => void (d.active = value))}
              />
              <Label htmlFor="plan-active">{t("fields.active")}</Label>
            </div>
          )}
        </CardContent>
      </Card>

      {state.stages.map((stage, stageIndex) => (
        <Card key={stageIndex} role="region" aria-label={t("place.stages", { n: stageIndex + 1 })}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("place.stages", { n: stageIndex + 1 })}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={stage.stageId}
                onValueChange={(value) => edit((d) => void (d.stages[stageIndex]!.stageId = value))}
              >
                <SelectTrigger aria-label={t("fields.stage")} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("moveUp")}
                onClick={() => edit((d) => move(d.stages, stageIndex, -1))}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("moveDown")}
                onClick={() => edit((d) => move(d.stages, stageIndex, 1))}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("removeStage")}
                onClick={() => edit((d) => void d.stages.splice(stageIndex, 1))}
              >
                <Trash2Icon />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {stage.sessions.map((session, sessionIndex) => (
              <div
                key={sessionIndex}
                className="space-y-3 rounded-lg border p-3"
                role="group"
                aria-label={t("place.sessions", { n: sessionIndex + 1 })}
              >
                <div className="flex flex-wrap items-end gap-3">
                  {!template && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor={`w-${stageIndex}-${sessionIndex}`}>{t("fields.week")}</Label>
                        <Input
                          id={`w-${stageIndex}-${sessionIndex}`}
                          className="w-20"
                          inputMode="numeric"
                          value={session.week}
                          onChange={(event) =>
                            edit((d) => void (d.stages[stageIndex]!.sessions[sessionIndex]!.week = event.target.value))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`n-${stageIndex}-${sessionIndex}`}>{t("fields.number")}</Label>
                        <Input
                          id={`n-${stageIndex}-${sessionIndex}`}
                          className="w-20"
                          inputMode="numeric"
                          value={session.number}
                          onChange={(event) =>
                            edit(
                              (d) => void (d.stages[stageIndex]!.sessions[sessionIndex]!.number = event.target.value),
                            )
                          }
                        />
                      </div>
                    </>
                  )}
                  <div className="min-w-48 flex-1 space-y-1">
                    <Label htmlFor={`g-${stageIndex}-${sessionIndex}`}>{t("fields.sessionGoal")}</Label>
                    <Input
                      id={`g-${stageIndex}-${sessionIndex}`}
                      value={session.goal}
                      onChange={(event) =>
                        edit((d) => void (d.stages[stageIndex]!.sessions[sessionIndex]!.goal = event.target.value))
                      }
                    />
                  </div>
                  {!template && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("copySession")}
                        onClick={() =>
                          edit((d) => {
                            const sessions = d.stages[stageIndex]!.sessions;
                            const copy = structuredClone(sessions[sessionIndex]!);
                            copy.number = String(Number(copy.number || 0) + 1);
                            sessions.splice(sessionIndex + 1, 0, copy);
                          })
                        }
                      >
                        <CopyIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("removeSession")}
                        onClick={() => edit((d) => void d.stages[stageIndex]!.sessions.splice(sessionIndex, 1))}
                      >
                        <Trash2Icon />
                      </Button>
                    </>
                  )}
                </div>

                {session.items.map((item, itemIndex) => {
                  const exercise = kindOf.get(item.exerciseId);
                  const columns = exercise?.kind === "CARDIO" ? CARDIO_COLUMNS : STRENGTH_COLUMNS;
                  return (
                    <div
                      key={itemIndex}
                      className="space-y-2 rounded-md bg-muted/40 p-3"
                      role="group"
                      aria-label={exercise?.name ?? t("place.items", { n: itemIndex + 1 })}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{exercise?.name ?? "—"}</span>
                          {exercise && (
                            <Badge variant={exercise.kind === "CARDIO" ? "info" : "outline"}>
                              {t(`kinds.${exercise.kind}`)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("moveUp")}
                            onClick={() =>
                              edit((d) => move(d.stages[stageIndex]!.sessions[sessionIndex]!.items, itemIndex, -1))
                            }
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("moveDown")}
                            onClick={() =>
                              edit((d) => move(d.stages[stageIndex]!.sessions[sessionIndex]!.items, itemIndex, 1))
                            }
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("removeExercise")}
                            onClick={() =>
                              edit((d) => void d.stages[stageIndex]!.sessions[sessionIndex]!.items.splice(itemIndex, 1))
                            }
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </div>
                      <Table aria-label={exercise?.name}>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("set.no")}</TableHead>
                            {columns.map((column) => (
                              <TableHead key={column}>{label(column)}</TableHead>
                            ))}
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {item.sets.map((set, setIndex) => (
                            <TableRow key={setIndex}>
                              <TableCell>{setIndex + 1}</TableCell>
                              {columns.map((column) => (
                                <TableCell key={column}>
                                  <Input
                                    aria-label={`${t("place.sets", { n: setIndex + 1 })} · ${label(column)}`}
                                    className={
                                      column === "notes" || column === "technique" || column === "videoUrl"
                                        ? "min-w-32"
                                        : "w-20"
                                    }
                                    inputMode={
                                      ["tempo", "technique", "notes", "videoUrl"].includes(column) ? "text" : "decimal"
                                    }
                                    value={set[column]}
                                    onChange={(event) =>
                                      edit(
                                        (d) =>
                                          void (d.stages[stageIndex]!.sessions[sessionIndex]!.items[itemIndex]!.sets[
                                            setIndex
                                          ]![column] = event.target.value),
                                      )
                                    }
                                  />
                                </TableCell>
                              ))}
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t("removeSet")}
                                  onClick={() =>
                                    edit(
                                      (d) =>
                                        void d.stages[stageIndex]!.sessions[sessionIndex]!.items[
                                          itemIndex
                                        ]!.sets.splice(setIndex, 1),
                                    )
                                  }
                                >
                                  <Trash2Icon />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={item.sets.length >= PLAN_LIMITS.setsPerItem}
                        onClick={() =>
                          edit((d) => {
                            const sets = d.stages[stageIndex]!.sessions[sessionIndex]!.items[itemIndex]!.sets;
                            sets.push(structuredClone(sets.at(-1) ?? emptySet()));
                          })
                        }
                      >
                        <PlusIcon />
                        {t("addSet")}
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={session.items.length >= PLAN_LIMITS.itemsPerSession}
                  onClick={() => setPicking({ stage: stageIndex, session: sessionIndex })}
                >
                  <PlusIcon />
                  {t("addExercise")}
                </Button>
              </div>
            ))}
            {!template && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  edit((d) => {
                    const sessions = d.stages[stageIndex]!.sessions;
                    const last = sessions.at(-1);
                    sessions.push({
                      week: last ? last.week : "1",
                      number: last ? String(Number(last.number || 0) + 1) : "1",
                      goal: "",
                      items: [],
                    });
                  })
                }
              >
                <PlusIcon />
                {t("addSession")}
              </Button>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={state.stages.length >= PLAN_LIMITS.stages || stages.length === 0}
          onClick={() =>
            edit((d) => {
              const used = new Set(d.stages.map((stage) => stage.stageId));
              const free = stages.find((option) => !used.has(option.id)) ?? stages[0]!;
              d.stages.push({
                stageId: free.id,
                sessions: template ? [{ week: "", number: "", goal: "", items: [] }] : [],
              });
            })
          }
        >
          <PlusIcon />
          {t("addStage")}
        </Button>
      </div>

      {problems.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p className="font-medium">{t("problems")}</p>
          <ul className="list-disc pl-5">
            {problems.map((problem, index) => (
              <li key={index}>
                {placeOf(problem.where, t as unknown as Translate)}
                {problem.where ? ": " : ""}
                {validationMessage(problem.code)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => run("save")}>
          {pending ? common("saving") : t("saveDraft")}
        </Button>
        <Button type="button" disabled={pending} onClick={() => run("send")}>
          {t("saveAndSend")}
        </Button>
      </div>

      <ExercisePicker
        open={picking !== null}
        exercises={exercises}
        onClose={() => setPicking(null)}
        onPick={addExercise}
      />
    </div>
  );
}

/** The catalog's exercises, searched on screen (accents and capitals ignored), to put one in a session. */
export function ExercisePicker({
  open,
  exercises,
  onClose,
  onPick,
}: {
  open: boolean;
  exercises: Exercise[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("workoutPlans");
  const [query, setQuery] = useState("");
  const search = normalizeForSearch(query);
  const found = exercises
    .filter((exercise) => !search || normalizeForSearch(exercise.name).includes(search))
    .slice(0, 50);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("pickExercise")}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            className="pl-8"
            aria-label={t("searchExercise")}
            placeholder={t("searchExercise")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <ul className="space-y-1">
          {found.map((exercise) => (
            <li key={exercise.id}>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-between py-2"
                onClick={() => onPick(exercise.id)}
              >
                <span className="text-left">
                  <span className="block font-medium">{exercise.name}</span>
                  <span className="block text-xs text-muted-foreground">{exercise.area.path}</span>
                </span>
                <Badge variant={exercise.kind === "CARDIO" ? "info" : "outline"}>{t(`kinds.${exercise.kind}`)}</Badge>
              </Button>
            </li>
          ))}
          {found.length === 0 && <li className="text-sm text-muted-foreground">{t("noExercise")}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
