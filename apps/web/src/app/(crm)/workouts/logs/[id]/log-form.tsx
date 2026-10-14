"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { useValidationMessage } from "@/components/form-fields";
import type { ChosenOption, Option } from "@flow/shared/options";
import {
  DEFAULT_ACTION_CODE,
  DEFAULT_FLAG_CODE,
  LOG_LIMITS,
  LOG_SCALE,
  actualsOf,
  logContentSchema,
  type Exercise,
  type Log,
  type LogContentInput,
  type LogSet,
} from "@flow/shared/workouts";
import { ExercisePicker } from "../../plans/[id]/plan-editor";
import { saveLogAction } from "../actions";

// The session log (M7.3, brief §7.3), built for a phone: the coach asks the customer and types it all. Plan and actual sit
// on one row per set; the actual starts as the plan, the Flag as Normal and the Action as None, and only the differences
// are changed.

const ACTUAL_FIELDS = ["weight", "reps", "rir", "durationMinutes", "speed", "heartRate"] as const;
type ActualField = (typeof ACTUAL_FIELDS)[number];
const NONE = "none";

type SetState = Record<ActualField, string> & {
  id?: string;
  planned: LogSet["planned"];
  flagId: string;
  flagNote: string;
  actionId: string;
  actionNote: string;
  note: string;
};
type ItemState = { id?: string; planned: boolean; exerciseId: string; sets: SetState[] };
type Scale = { value: string; note: string };
type Choice = { id: string; note: string };
type State = {
  goal: string;
  preStress: Scale;
  preEnergy: Scale;
  preImpact: Choice;
  postSrpe: Scale;
  postEnergy: Scale;
  postSummary: Choice;
  coachNotes: string;
  items: ItemState[];
};

export type LogOptions = { flags: Option[]; actions: Option[]; impacts: Option[]; summaries: Option[] };

const text = (value: number | string | null) => (value === null ? "" : String(value));

function stateOf(log: Log): State {
  return {
    goal: log.goal ?? "",
    preStress: { value: text(log.pre.stress.value), note: log.pre.stress.note ?? "" },
    preEnergy: { value: text(log.pre.energy.value), note: log.pre.energy.note ?? "" },
    preImpact: { id: log.pre.impact?.id ?? "", note: log.pre.impact?.note ?? "" },
    postSrpe: { value: text(log.post.srpe.value), note: log.post.srpe.note ?? "" },
    postEnergy: { value: text(log.post.energy.value), note: log.post.energy.note ?? "" },
    postSummary: { id: log.post.summary?.id ?? "", note: log.post.summary?.note ?? "" },
    coachNotes: log.coachNotes ?? "",
    items: log.items.map((item) => ({
      id: item.id,
      planned: item.planned,
      exerciseId: item.exercise.id,
      sets: item.sets.map((set) => ({
        id: set.id,
        planned: set.planned,
        weight: text(set.weight),
        reps: text(set.reps),
        rir: text(set.rir),
        durationMinutes: text(set.durationMinutes),
        speed: text(set.speed),
        heartRate: text(set.heartRate),
        flagId: set.flag.id,
        flagNote: set.flag.note ?? "",
        actionId: set.action.id,
        actionNote: set.action.note ?? "",
        note: set.note ?? "",
      })),
    })),
  };
}

type Problem = { where: string; code: string };
type Translate = (key: string, values?: Record<string, string | number>) => string;

export function LogForm({
  log,
  options,
  exercises,
}: {
  log: Log;
  options: LogOptions;
  /** The catalog's exercises for the coach to add one; empty when the log is read-only. */
  exercises: Exercise[];
}) {
  const t = useTranslations("workoutLogs");
  const plans = useTranslations("workoutPlans");
  const common = useTranslations("common");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const validationMessage = useValidationMessage();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>(() => stateOf(log));
  const [problems, setProblems] = useState<Problem[]>([]);
  const [picking, setPicking] = useState(false);
  const readOnly = !log.canEdit;
  const kindOf = new Map<string, "STRENGTH" | "CARDIO">([
    ...log.items.map((item) => [item.exercise.id, item.exercise.kind] as const),
    ...exercises.map((exercise) => [exercise.id, exercise.kind] as const),
  ]);
  const nameOf = new Map<string, string>([
    ...log.items.map((item) => [item.exercise.id, item.exercise.name] as const),
    ...exercises.map((exercise) => [exercise.id, exercise.name] as const),
  ]);

  const defaultOf = (list: Option[], code: string) =>
    (list.find((option) => option.code === code) ?? list.find((option) => !option.isOther))?.id ?? "";
  const defaultFlag = defaultOf(options.flags, DEFAULT_FLAG_CODE);
  const defaultAction = defaultOf(options.actions, DEFAULT_ACTION_CODE);

  const edit = (change: (draft: State) => void) =>
    setState((previous) => {
      const next = structuredClone(previous);
      change(next);
      return next;
    });

  const content = (): LogContentInput => ({
    goal: state.goal,
    preStress: state.preStress.value,
    preStressNote: state.preStress.note,
    preEnergy: state.preEnergy.value,
    preEnergyNote: state.preEnergy.note,
    preImpactId: state.preImpact.id,
    preImpactNote: state.preImpact.note,
    postSrpe: state.postSrpe.value,
    postSrpeNote: state.postSrpe.note,
    postEnergy: state.postEnergy.value,
    postEnergyNote: state.postEnergy.note,
    postSummaryId: state.postSummary.id,
    postSummaryNote: state.postSummary.note,
    coachNotes: state.coachNotes,
    items: state.items.map((item) => ({
      id: item.id,
      exerciseId: item.exerciseId,
      sets: item.sets.map((set) => ({
        id: set.id,
        weight: set.weight,
        reps: set.reps,
        rir: set.rir,
        durationMinutes: set.durationMinutes,
        speed: set.speed,
        heartRate: set.heartRate,
        flagId: set.flagId,
        flagNote: set.flagNote,
        actionId: set.actionId,
        actionNote: set.actionNote,
        note: set.note,
      })),
    })),
  });

  const save = () =>
    startTransition(async () => {
      setProblems([]);
      const checked = logContentSchema.safeParse(content());
      if (!checked.success) {
        setProblems(checked.error.issues.map((issue) => ({ where: issue.path.join("."), code: issue.message })));
        return;
      }
      const result = await saveLogAction(log.id, content());
      if (!result.ok) {
        setProblems(
          Object.entries(result.fieldErrors ?? {}).flatMap(([where, codes]) => codes.map((code) => ({ where, code }))),
        );
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t("saved"));
      router.refresh();
    });

  const emptySet = (kind: "STRENGTH" | "CARDIO", like?: SetState): SetState => {
    const set = {
      planned: null,
      flagId: defaultFlag,
      flagNote: "",
      actionId: defaultAction,
      actionNote: "",
      note: "",
      weight: "",
      reps: "",
      rir: "",
      durationMinutes: "",
      speed: "",
      heartRate: "",
    } satisfies SetState;
    // A new set starts as the one before it, so the coach changes only the difference.
    if (like) for (const field of actualsOf(kind)) set[field] = like[field];
    return set;
  };

  const addExercise = (exerciseId: string) => {
    edit((draft) => {
      draft.items.push({ planned: false, exerciseId, sets: [emptySet(kindOf.get(exerciseId) ?? "STRENGTH")] });
    });
    setPicking(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("parts.info")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="log-goal">{t("fields.goal")}</Label>
            <Input
              id="log-goal"
              disabled={readOnly}
              value={state.goal}
              onChange={(event) => edit((d) => void (d.goal = event.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      <Card role="region" aria-label={t("parts.pre")}>
        <CardHeader>
          <CardTitle>{t("parts.pre")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ScaleField
            label={t("fields.stress")}
            disabled={readOnly}
            value={state.preStress}
            onChange={(value) => edit((d) => void (d.preStress = value))}
          />
          <ScaleField
            label={t("fields.energy")}
            disabled={readOnly}
            value={state.preEnergy}
            onChange={(value) => edit((d) => void (d.preEnergy = value))}
          />
          <ChoiceField
            label={t("fields.impact")}
            disabled={readOnly}
            options={withCurrent(options.impacts, log.pre.impact)}
            optional
            value={state.preImpact}
            onChange={(value) => edit((d) => void (d.preImpact = value))}
          />
        </CardContent>
      </Card>

      <Card role="region" aria-label={t("parts.during")}>
        <CardHeader>
          <CardTitle>{t("parts.during")}</CardTitle>
          {log.plan && (
            <p className="text-sm text-muted-foreground">
              {log.planSession
                ? t("followsSession", {
                    plan: log.plan.name,
                    week: log.planSession.week ?? 0,
                    number: log.planSession.number ?? 0,
                  })
                : log.plan.name}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {state.items.length === 0 && <p className="text-sm text-muted-foreground">{t("noExercises")}</p>}
          {state.items.map((item, itemIndex) => {
            const kind = kindOf.get(item.exerciseId) ?? "STRENGTH";
            const name = nameOf.get(item.exerciseId) ?? "—";
            const columns = actualsOf(kind);
            const itemBefore = log.items.find((row) => row.id === item.id);
            return (
              <div
                key={item.id ?? `new-${itemIndex}`}
                className="space-y-3 rounded-lg bg-muted/40 p-3"
                role="group"
                aria-label={name}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{name}</span>
                    <Badge variant={kind === "CARDIO" ? "info" : "outline"}>{plans(`kinds.${kind}`)}</Badge>
                    {!item.planned && <Badge variant="muted">{t("addedByCoach")}</Badge>}
                  </div>
                  {!item.planned && !readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("removeExercise")}
                      onClick={() => edit((d) => void d.items.splice(itemIndex, 1))}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                </div>

                {item.sets.map((set, setIndex) => {
                  const setLabel = plans("place.sets", { n: setIndex + 1 });
                  const before = itemBefore?.sets.find((row) => row.id === set.id);
                  return (
                    <div
                      key={set.id ?? `new-${setIndex}`}
                      className="space-y-3 rounded-md border bg-background p-3"
                      role="group"
                      aria-label={`${name} · ${setLabel}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{setLabel}</span>
                        {set.planned ? (
                          <span className="text-xs text-muted-foreground">
                            {t("plan")}: {plannedText(set.planned, kind, t as unknown as Translate)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("noPlanForSet")}</span>
                        )}
                        {!set.planned && !readOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("removeSet")}
                            onClick={() => edit((d) => void d.items[itemIndex]!.sets.splice(setIndex, 1))}
                          >
                            <Trash2Icon />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {columns.map((column) => (
                          <div key={column} className="space-y-1">
                            <Label className="text-xs">{plans(`set.${column}`)}</Label>
                            <Input
                              aria-label={`${setLabel} · ${plans(`set.${column}`)}`}
                              inputMode="decimal"
                              disabled={readOnly}
                              value={set[column]}
                              onChange={(event) =>
                                edit((d) => void (d.items[itemIndex]!.sets[setIndex]![column] = event.target.value))
                              }
                            />
                          </div>
                        ))}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <ChoiceField
                          label={`${setLabel} · ${t("fields.flag")}`}
                          disabled={readOnly}
                          options={withCurrent(options.flags, before?.flag ?? null)}
                          value={{ id: set.flagId, note: set.flagNote }}
                          onChange={(value) =>
                            edit((d) => {
                              const target = d.items[itemIndex]!.sets[setIndex]!;
                              target.flagId = value.id;
                              target.flagNote = value.note;
                            })
                          }
                        />
                        <ChoiceField
                          label={`${setLabel} · ${t("fields.action")}`}
                          disabled={readOnly}
                          options={withCurrent(options.actions, before?.action ?? null)}
                          value={{ id: set.actionId, note: set.actionNote }}
                          onChange={(value) =>
                            edit((d) => {
                              const target = d.items[itemIndex]!.sets[setIndex]!;
                              target.actionId = value.id;
                              target.actionNote = value.note;
                            })
                          }
                        />
                      </div>
                      <Input
                        aria-label={`${setLabel} · ${t("fields.setNote")}`}
                        placeholder={t("fields.setNote")}
                        disabled={readOnly}
                        value={set.note}
                        onChange={(event) =>
                          edit((d) => void (d.items[itemIndex]!.sets[setIndex]!.note = event.target.value))
                        }
                      />
                    </div>
                  );
                })}
                {!readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={item.sets.length >= LOG_LIMITS.setsPerItem}
                    onClick={() => edit((d) => void d.items[itemIndex]!.sets.push(emptySet(kind, item.sets.at(-1))))}
                  >
                    <PlusIcon />
                    {t("addSet")}
                  </Button>
                )}
              </div>
            );
          })}
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              disabled={state.items.length >= LOG_LIMITS.itemsPerLog}
              onClick={() => setPicking(true)}
            >
              <PlusIcon />
              {plans("addExercise")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card role="region" aria-label={t("parts.post")}>
        <CardHeader>
          <CardTitle>{t("parts.post")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ScaleField
            label={t("fields.srpe")}
            disabled={readOnly}
            value={state.postSrpe}
            onChange={(value) => edit((d) => void (d.postSrpe = value))}
          />
          <ScaleField
            label={t("fields.energyAfter")}
            disabled={readOnly}
            value={state.postEnergy}
            onChange={(value) => edit((d) => void (d.postEnergy = value))}
          />
          <ChoiceField
            label={t("fields.summary")}
            disabled={readOnly}
            options={withCurrent(options.summaries, log.post.summary)}
            optional
            value={state.postSummary}
            onChange={(value) => edit((d) => void (d.postSummary = value))}
          />
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="log-coach-notes">{t("fields.coachNotes")}</Label>
            <Textarea
              id="log-coach-notes"
              disabled={readOnly}
              value={state.coachNotes}
              onChange={(event) => edit((d) => void (d.coachNotes = event.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      {problems.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p className="font-medium">{t("problems")}</p>
          <ul className="list-disc pl-5">
            {problems.map((problem, index) => (
              <li key={index}>
                {placeOf(problem.where, t as unknown as Translate, plans as unknown as Translate, nameOf, state)}
                {problem.where ? ": " : ""}
                {validationMessage(problem.code)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {readOnly ? (
        <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
      ) : (
        <div className="sticky bottom-0 -mx-4 flex justify-end border-t bg-background/95 p-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <Button type="button" className="w-full sm:w-auto" disabled={pending} onClick={save}>
            {pending ? common("saving") : t("save")}
          </Button>
        </div>
      )}

      <ExercisePicker open={picking} exercises={exercises} onClose={() => setPicking(false)} onPick={addExercise} />
    </div>
  );
}

/** The options to pick from: the active ones, and the one the record already has even if it was retired since. */
function withCurrent(options: Option[], current: ChosenOption | null): Option[] {
  if (!current || options.some((option) => option.id === current.id)) return options;
  return [
    ...options,
    {
      id: current.id,
      listKey: options[0]?.listKey ?? ("workoutFlags" as Option["listKey"]),
      labelVi: current.labelVi,
      labelEn: current.labelEn,
      code: current.code,
      sortOrder: 0,
      active: false,
      isOther: current.isOther,
    },
  ];
}

/** The plan's targets of a set in a line: "40 kg × 10 · RIR 3", or "15 phút · 8.5 km/h · 130 bpm" for Cardio. */
function plannedText(planned: NonNullable<LogSet["planned"]>, kind: "STRENGTH" | "CARDIO", t: Translate): string {
  const v = (value: number | null) => (value === null ? "—" : String(value));
  return kind === "CARDIO"
    ? t("planCardio", { minutes: v(planned.durationMinutes), speed: v(planned.speed), heartRate: v(planned.heartRate) })
    : t("planStrength", { weight: v(planned.weight), reps: v(planned.reps), rir: v(planned.rir) });
}

/** A 1 to 10 scale with its note (brief §7.3). */
function ScaleField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: Scale;
  disabled: boolean;
  onChange: (value: Scale) => void;
}) {
  const t = useTranslations("workoutLogs");
  const steps = Array.from({ length: LOG_SCALE.max - LOG_SCALE.min + 1 }, (_, index) => String(LOG_SCALE.min + index));
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value.value === "" ? NONE : value.value}
        disabled={disabled}
        onValueChange={(next) => onChange({ ...value, value: next === NONE ? "" : next })}
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>—</SelectItem>
          {steps.map((step) => (
            <SelectItem key={step} value={step}>
              {step}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        aria-label={`${label} · ${t("fields.scaleNote")}`}
        placeholder={t("fields.scaleNote")}
        disabled={disabled}
        value={value.note}
        onChange={(event) => onChange({ ...value, note: event.target.value })}
      />
    </div>
  );
}

/** An option of an admin list; "Khác" shows a note that must be filled (D-016). */
function ChoiceField({
  label,
  options,
  value,
  optional = false,
  disabled,
  onChange,
}: {
  label: string;
  options: Option[];
  value: Choice;
  optional?: boolean;
  disabled: boolean;
  onChange: (value: Choice) => void;
}) {
  const t = useTranslations("workoutLogs");
  const locale = useLocale();
  const chosen = options.find((option) => option.id === value.id);
  return (
    <div className="space-y-2">
      <Label className="text-xs sm:text-sm">{label}</Label>
      <Select
        value={value.id === "" ? NONE : value.id}
        disabled={disabled}
        onValueChange={(next) => onChange({ id: next === NONE ? "" : next, note: "" })}
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value={NONE}>—</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {locale === "vi" ? option.labelVi : option.labelEn}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {chosen?.isOther && (
        <Input
          aria-label={`${label} · ${t("fields.otherNote")}`}
          placeholder={t("fields.otherNote")}
          disabled={disabled}
          value={value.note}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      )}
    </div>
  );
}

/** "items.0.sets.1.weight" in words: Squat · Set 2 · weight. Other paths name their field. */
function placeOf(path: string, t: Translate, plans: Translate, names: Map<string, string>, state: State): string {
  const [head, itemIndex, sets, setIndex, field] = path.split(".");
  if (head === "items" && itemIndex !== undefined && /^\d+$/.test(itemIndex)) {
    const name =
      names.get(state.items[Number(itemIndex)]?.exerciseId ?? "") ?? plans("place.items", { n: Number(itemIndex) + 1 });
    if (sets === "sets" && setIndex !== undefined) {
      const label = plans("place.sets", { n: Number(setIndex) + 1 });
      return field ? `${name} · ${label} · ${fieldLabel(field, t, plans)}` : `${name} · ${label}`;
    }
    return name;
  }
  return path ? fieldLabel(head ?? path, t, plans) : "";
}

function fieldLabel(field: string, t: Translate, plans: Translate) {
  if ((ACTUAL_FIELDS as readonly string[]).includes(field)) return plans(`set.${field}`);
  const known: Record<string, string> = {
    goal: "goal",
    preStress: "stress",
    preStressNote: "scaleNote",
    preEnergy: "energy",
    preEnergyNote: "scaleNote",
    preImpactId: "impact",
    preImpactNote: "otherNote",
    postSrpe: "srpe",
    postSrpeNote: "scaleNote",
    postEnergy: "energyAfter",
    postEnergyNote: "scaleNote",
    postSummaryId: "summary",
    postSummaryNote: "otherNote",
    coachNotes: "coachNotes",
    flagId: "flag",
    flagNote: "otherNote",
    actionId: "action",
    actionNote: "otherNote",
    note: "setNote",
  };
  return known[field] ? t(`fields.${known[field]}`) : field;
}
