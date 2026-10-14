import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateTime } from "@/components/date-time";
import { ChosenOptionText } from "@/components/option-select";
import type { WorkoutProgress } from "@flow/shared/workouts";

const dash = (value: number | null) => (value === null ? "—" : String(value));

/** The customer's training progress (brief §7.5, AC-20): sessions against the plan, and how each measure moved. */
export async function CustomerProgress({ progress }: { progress: WorkoutProgress }) {
  const t = await getTranslations("workoutProgress");
  const plans = await getTranslations("workoutPlans");

  return (
    <section className="space-y-4" aria-label={t("title")}>
      <h3 className="text-sm font-medium">{t("title")}</h3>
      {progress.plan ? (
        <Card role="region" aria-label={t("summary")}>
          <CardHeader>
            <CardTitle>{progress.plan.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">{t("sessionsDone")}</dt>
                <dd className="font-medium tabular-nums">
                  {t("doneOfPlanned", { done: progress.plan.done, planned: progress.plan.planned })}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("phase")}</dt>
                <dd className="font-medium">{progress.plan.phase ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("stage")}</dt>
                <dd className="font-medium">{progress.plan.currentStage ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("goal")}</dt>
                <dd className="font-medium">{progress.plan.goal ?? "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noPlan")}</p>
      )}

      {progress.sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noSessions")}</p>
      ) : (
        <>
          <Table aria-label={t("sessions")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.session")}</TableHead>
                <TableHead className="text-right">{t("fields.stress")}</TableHead>
                <TableHead className="text-right">{t("fields.energy")}</TableHead>
                <TableHead className="text-right">{t("fields.srpe")}</TableHead>
                <TableHead className="text-right">{t("fields.energyAfter")}</TableHead>
                <TableHead className="text-right">{t("fields.flagged")}</TableHead>
                <TableHead className="text-right">{t("fields.escalations")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {progress.sessions.map((session) => (
                <TableRow key={session.logId}>
                  <TableCell>
                    <Link className="underline underline-offset-4" href={`/workouts/logs/${session.logId}`}>
                      <DateTime value={session.sessionDate} format="dateTime" />
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{dash(session.stress)}</TableCell>
                  <TableCell className="text-right tabular-nums">{dash(session.energy)}</TableCell>
                  <TableCell className="text-right tabular-nums">{dash(session.srpe)}</TableCell>
                  <TableCell className="text-right tabular-nums">{dash(session.energyAfter)}</TableCell>
                  <TableCell className="text-right tabular-nums">{session.flagged}</TableCell>
                  <TableCell className="text-right tabular-nums">{session.escalations}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {progress.exercises.map(({ exercise, points }) => (
            <Card key={exercise.id} role="region" aria-label={exercise.name}>
              <CardHeader>
                <CardTitle className="text-base">
                  {exercise.name} · {plans(`kinds.${exercise.kind}`)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table aria-label={exercise.name}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("fields.session")}</TableHead>
                      <TableHead className="text-right">{t("fields.sets")}</TableHead>
                      {exercise.kind === "CARDIO" ? (
                        <>
                          <TableHead className="text-right">{plans("set.durationMinutes")}</TableHead>
                          <TableHead className="text-right">{plans("set.speed")}</TableHead>
                        </>
                      ) : (
                        <>
                          <TableHead className="text-right">{t("fields.topWeight")}</TableHead>
                          <TableHead className="text-right">{t("fields.totalReps")}</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {points.map((point) => (
                      <TableRow key={point.logId}>
                        <TableCell>
                          <DateTime value={point.sessionDate} format="dateOnly" />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{point.sets}</TableCell>
                        {exercise.kind === "CARDIO" ? (
                          <>
                            <TableCell className="text-right tabular-nums">{dash(point.durationMinutes)}</TableCell>
                            <TableCell className="text-right tabular-nums">{dash(point.averageSpeed)}</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-right tabular-nums">{dash(point.topWeight)}</TableCell>
                            <TableCell className="text-right tabular-nums">{dash(point.totalReps)}</TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}

          <Card role="region" aria-label={t("history")}>
            <CardHeader>
              <CardTitle className="text-base">{t("history")}</CardTitle>
            </CardHeader>
            <CardContent>
              {progress.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
              ) : (
                <Table aria-label={t("history")}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("fields.session")}</TableHead>
                      <TableHead>{t("fields.exercise")}</TableHead>
                      <TableHead>{t("fields.flag")}</TableHead>
                      <TableHead>{t("fields.action")}</TableHead>
                      <TableHead>{t("fields.note")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {progress.history.map((entry) => (
                      <TableRow key={`${entry.logId}-${entry.exercise}-${entry.setNo}`}>
                        <TableCell>
                          <Link className="underline underline-offset-4" href={`/workouts/logs/${entry.logId}`}>
                            <DateTime value={entry.sessionDate} format="dateTime" />
                          </Link>
                        </TableCell>
                        <TableCell>{t("exerciseSet", { exercise: entry.exercise, set: entry.setNo })}</TableCell>
                        <TableCell>
                          <ChosenOptionText option={entry.flag} />
                        </TableCell>
                        <TableCell>
                          <ChosenOptionText option={entry.action} />
                        </TableCell>
                        <TableCell>{entry.note ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
