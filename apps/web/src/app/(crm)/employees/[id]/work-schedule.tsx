"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateTime } from "@/components/date-time";
import { TextField, applyFieldErrors, useValidationMessage } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { formatDateOnly } from "@/lib/format";
import {
  WEEKDAYS,
  dayOffInputSchema,
  minutesOfTime,
  shiftsInputSchema,
  timeOfMinutes,
  type DayOff,
} from "@flow/shared/employees";
import { addDayOffAction, removeDayOffAction, replaceShiftsAction } from "../actions";

type Shift = { weekday: number; start: string; end: string };
type Row = Shift & { key: number };

/**
 * The weekly shifts (brief §8.4, D-030): one line per weekday, any number of shifts in
 * each. Saving replaces the whole pattern; bookings already made are not touched.
 */
export function ShiftsEditor({
  employeeId,
  shifts,
  editable,
}: {
  employeeId: string;
  shifts: Shift[];
  editable: boolean;
}) {
  const t = useTranslations("employees.schedule");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const validationMessage = useValidationMessage();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => shifts.map((shift, key) => ({ ...shift, key })));
  const [nextKey, setNextKey] = useState(shifts.length);
  /** Validation messages by row key, and one for the whole pattern. */
  const [errors, setErrors] = useState<{ rows: Map<number, string>; form: string | null }>({
    rows: new Map(),
    form: null,
  });

  const day = (weekday: number) => t(`weekdays.${weekday}` as Parameters<typeof t>[0]);

  if (!editable) {
    return (
      <ul className="flex flex-col divide-y rounded-lg border">
        {WEEKDAYS.map((weekday) => {
          const own = shifts.filter((shift) => shift.weekday === weekday);
          return (
            <li key={weekday} role="group" aria-label={day(weekday)} className="flex gap-2 p-3 text-sm">
              <span className="w-28 shrink-0 font-medium">{day(weekday)}</span>
              <span className="tabular-nums">
                {own.length ? own.map((shift) => `${shift.start}–${shift.end}`).join(", ") : t("dayOffWeekly")}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  const update = (key: number, change: Partial<Shift>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const remove = (key: number) => setRows((current) => current.filter((row) => row.key !== key));
  const add = (weekday: number) => {
    const last = rows.filter((row) => row.weekday === weekday).at(-1);
    const start = last && minutesOfTime(last.end) < 24 * 60 ? minutesOfTime(last.end) : 8 * 60;
    setRows((current) => [
      ...current,
      { key: nextKey, weekday, start: timeOfMinutes(start), end: timeOfMinutes(Math.min(start + 4 * 60, 24 * 60)) },
    ]);
    setNextKey(nextKey + 1);
  };

  const save = () => {
    const shiftsToSave = rows.map(({ weekday, start, end }) => ({ weekday, start, end }));
    const parsed = shiftsInputSchema.safeParse({ shifts: shiftsToSave });
    if (!parsed.success) {
      const byRow = new Map<number, string>();
      for (const issue of parsed.error.issues) {
        const index = issue.path[1];
        if (typeof index === "number" && !byRow.has(rows[index].key)) byRow.set(rows[index].key, issue.message);
      }
      setErrors({ rows: byRow, form: null });
      return;
    }
    setErrors({ rows: new Map(), form: null });
    startTransition(async () => {
      const result = await replaceShiftsAction(employeeId, { shifts: shiftsToSave });
      if (!result.ok) {
        setErrors({ rows: new Map(), form: result.fieldErrors?.shifts?.[0] ?? null });
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t("saved"));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y rounded-lg border">
        {WEEKDAYS.map((weekday) => {
          const own = rows.filter((row) => row.weekday === weekday);
          return (
            <li
              key={weekday}
              role="group"
              aria-label={day(weekday)}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start"
            >
              <span className="w-28 shrink-0 pt-2 text-sm font-medium">{day(weekday)}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {own.length === 0 && <span className="pt-2 text-sm text-muted-foreground">{t("dayOffWeekly")}</span>}
                {own.map((row, index) => {
                  const labels = { day: day(weekday), number: index + 1 };
                  const error = errors.rows.get(row.key);
                  return (
                    <div key={row.key} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Input
                          value={row.start}
                          onChange={(event) => update(row.key, { start: event.target.value })}
                          aria-label={t("shiftStart", labels)}
                          aria-invalid={Boolean(error)}
                          inputMode="numeric"
                          className="w-24 tabular-nums"
                        />
                        <span aria-hidden="true">–</span>
                        <Input
                          value={row.end}
                          onChange={(event) => update(row.key, { end: event.target.value })}
                          aria-label={t("shiftEnd", labels)}
                          aria-invalid={Boolean(error)}
                          inputMode="numeric"
                          className="w-24 tabular-nums"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("removeShift", labels)}
                          onClick={() => remove(row.key)}
                        >
                          <XIcon />
                        </Button>
                      </div>
                      {error && <FieldError>{validationMessage(error)}</FieldError>}
                    </div>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => add(weekday)}
                aria-label={t("addShift", { day: day(weekday) })}
              >
                <PlusIcon />
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {errors.form && <FieldError>{validationMessage(errors.form)}</FieldError>}
      <div>
        <Button type="button" onClick={save} disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

type DayOffValues = { date: string; note: string };

/** Days off from today on, with a form to add one and a button to remove each. */
export function DaysOff({
  employeeId,
  daysOff,
  editable,
}: {
  employeeId: string;
  daysOff: DayOff[];
  editable: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<DayOff | null>(null);
  const form = useForm<DayOffValues>({
    resolver: zodResolver(dayOffInputSchema, undefined, { raw: true }) as never,
    defaultValues: { date: "", note: "" },
  });
  const s = useTranslations("employees.schedule");

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await addDayOffAction(employeeId, values);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(s("dayOffAdded", { date: values.date }));
      form.reset();
      router.refresh();
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      {daysOff.length === 0 ? (
        <p className="text-sm text-muted-foreground">{s("noDaysOff")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-label={s("daysOff")}>
            <TableHeader>
              <TableRow>
                <TableHead>{s("date")}</TableHead>
                <TableHead>{s("note")}</TableHead>
                {editable && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {daysOff.map((dayOff) => (
                <TableRow key={dayOff.id}>
                  <TableCell className="tabular-nums">
                    <DateTime value={dayOff.date} format="dateOnly" />
                  </TableCell>
                  <TableCell>{dayOff.note}</TableCell>
                  {editable && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={s("removeDayOff", { date: formatDateOnly(dayOff.date) })}
                        onClick={() => setRemoving(dayOff)}
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editable && (
        <form onSubmit={onSubmit} noValidate className="grid items-start gap-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
          <TextField
            control={form.control}
            name="date"
            label={s("date")}
            placeholder={t("employees.birthDatePlaceholder")}
            autoComplete="off"
          />
          <TextField control={form.control} name="note" label={s("note")} autoComplete="off" />
          <Button type="submit" variant="outline" disabled={pending} className="sm:mt-6">
            <PlusIcon />
            {s("addDayOff")}
          </Button>
        </form>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? s("removeDayOffTitle", { date: formatDateOnly(removing.date) }) : ""}
        description={s("removeDayOffBody")}
        confirmLabel={removing ? s("removeDayOff", { date: formatDateOnly(removing.date) }) : ""}
        onConfirm={async () => {
          if (!removing) return;
          const result = await removeDayOffAction(employeeId, removing.id);
          if (!result.ok) {
            notify.error(errorMessage(result.code));
            return false;
          }
          notify.success(s("dayOffRemoved", { date: formatDateOnly(removing.date) }));
          router.refresh();
        }}
      />
    </div>
  );
}
