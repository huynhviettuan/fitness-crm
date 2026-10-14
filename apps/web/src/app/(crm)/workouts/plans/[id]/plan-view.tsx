import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Plan, PlanSet } from "@flow/shared/workouts";

const STRENGTH_COLUMNS = ["weight", "reps", "restSeconds", "rir", "tempo", "technique", "notes", "videoUrl"] as const;
const CARDIO_COLUMNS = ["durationMinutes", "speed", "heartRate", "notes"] as const;

/** A plan as it is, read-only: the stages, their sessions by week, the exercises, and the targets of each set (brief §7.2). */
export async function PlanView({ plan }: { plan: Plan }) {
  const t = await getTranslations("workoutPlans");
  const template = plan.kind === "TEMPLATE";
  const show = (set: PlanSet, column: keyof PlanSet) => {
    const value = set[column];
    if (value === null || value === "") return "—";
    if (column === "videoUrl" && typeof value === "string") {
      return (
        <a href={value} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
          {t("videoOpen")}
        </a>
      );
    }
    return String(value);
  };

  return (
    <div className="space-y-6">
      {plan.stages.length === 0 && <p className="text-sm text-muted-foreground">{t("noStages")}</p>}
      {plan.stages.map((stage, stageIndex) => (
        <Card key={stage.id} role="region" aria-label={stage.stage.name}>
          <CardHeader>
            <CardTitle>
              {t("place.stages", { n: stageIndex + 1 })} · {stage.stage.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stage.sessions.map((session) => (
              <div
                key={session.id}
                className="space-y-3 rounded-lg border p-3"
                role="group"
                aria-label={
                  template
                    ? stage.stage.name
                    : t("sessionLabel", { week: session.week ?? 0, number: session.number ?? 0 })
                }
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  {!template && (
                    <span className="font-medium">
                      {t("sessionLabel", { week: session.week ?? 0, number: session.number ?? 0 })}
                    </span>
                  )}
                  {session.goal && <span className="text-sm text-muted-foreground">{session.goal}</span>}
                </div>
                {session.items.length === 0 && <p className="text-sm text-muted-foreground">{t("noExercises")}</p>}
                {session.items.map((item) => {
                  const columns = item.exercise.kind === "CARDIO" ? CARDIO_COLUMNS : STRENGTH_COLUMNS;
                  return (
                    <div key={item.id} className="space-y-2 rounded-md bg-muted/40 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.exercise.name}</span>
                        <Badge variant={item.exercise.kind === "CARDIO" ? "info" : "outline"}>
                          {t(`kinds.${item.exercise.kind}`)}
                        </Badge>
                        {item.exercise.equipmentName && (
                          <span className="text-xs text-muted-foreground">{item.exercise.equipmentName}</span>
                        )}
                      </div>
                      {item.sets.length > 0 && (
                        <Table aria-label={item.exercise.name}>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("set.no")}</TableHead>
                              {columns.map((column) => (
                                <TableHead key={column}>{t(`set.${column}`)}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {item.sets.map((set) => (
                              <TableRow key={set.id}>
                                <TableCell>{set.setNo}</TableCell>
                                {columns.map((column) => (
                                  <TableCell key={column}>{show(set, column)}</TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
