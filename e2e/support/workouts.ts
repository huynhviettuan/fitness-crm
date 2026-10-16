import { expect, type APIRequestContext } from "@playwright/test";
import { approvePendingViaApi } from "./approvals";
import { bookingSetup, createBookingViaApi, randomBookingDay } from "./data";

export type ApiAs = (role: "ADMIN" | "FITNESS_MANAGER" | "RECEPTIONIST" | "PT") => Promise<APIRequestContext>;

/**
 * A small catalog named with the test's tag (so searches find only these): a stage, and a Strength, a Cardio and a second
 * Strength exercise under one area. Names are returned beside the ids; the teardown deletes them by the tag.
 */
export async function workoutCatalog(apiAs: ApiAs, tag: string) {
  const admin = await apiAs("ADMIN");
  const post = async (path: string, data: Record<string, unknown>) => {
    const response = await admin.post(`/api/v1/workout/${path}`, { data });
    expect(response.status(), path).toBe(201);
    return (await response.json()) as { id: string };
  };
  const stage = await post("stages", { name: `Rehab ${tag}` });
  const area = await post("areas", { code: `A-${tag}`, name: `Vùng ${tag}` });
  const squat = await post("exercises", { name: `Squat ${tag}`, areaId: area.id, kind: "STRENGTH" });
  const run = await post("exercises", { name: `Chạy bộ ${tag}`, areaId: area.id, kind: "CARDIO" });
  const press = await post("exercises", { name: `Đẩy tạ ${tag}`, areaId: area.id, kind: "STRENGTH" });
  return {
    stageId: stage.id,
    stage: `Rehab ${tag}`,
    squatId: squat.id,
    squat: `Squat ${tag}`,
    runId: run.id,
    run: `Chạy bộ ${tag}`,
    pressId: press.id,
    press: `Đẩy tạ ${tag}`,
  };
}

/**
 * An approved plan of the customer for the coach: session 1 has the Squat (40 kg × 10 · RIR 3, then 45 × 8) and a run
 * (15 minutes at 8.5 km/h, heart rate 130); session 2 has the Squat again. The manager writes it and an admin approves.
 */
export async function approvedPlanViaApi(
  apiAs: ApiAs,
  refs: { customerId: string; contractId: string; trainerId: string },
  catalog: Awaited<ReturnType<typeof workoutCatalog>>,
  tag: string,
) {
  const manager = await apiAs("FITNESS_MANAGER");
  const created = await manager.post("/api/v1/workout/plans", { data: { kind: "CUSTOMER", ...refs } });
  expect(created.status(), "create plan").toBe(201);
  const plan = (await created.json()) as { id: string };
  const saved = await manager.put(`/api/v1/workout/plans/${plan.id}`, {
    data: {
      name: `Giáo án ${tag}`,
      stages: [
        {
          stageId: catalog.stageId,
          sessions: [
            {
              week: 1,
              number: 1,
              goal: "Làm quen",
              items: [
                {
                  exerciseId: catalog.squatId,
                  sets: [
                    { weight: "40", reps: "10", rir: "3", restSeconds: "90" },
                    { weight: "45", reps: "8" },
                  ],
                },
                { exerciseId: catalog.runId, sets: [{ durationMinutes: "15", speed: "8,5", heartRate: "130" }] },
              ],
            },
            {
              week: 1,
              number: 2,
              goal: "Tăng tải",
              items: [{ exerciseId: catalog.squatId, sets: [{ weight: "50", reps: "6" }] }],
            },
          ],
        },
      ],
    },
  });
  expect(saved.status(), "save plan").toBe(200);
  expect((await manager.post(`/api/v1/workout/plans/${plan.id}/submit`)).ok(), "submit plan").toBe(true);
  await approvePendingViaApi(await apiAs("ADMIN"), plan.id, "workout.plan");
  return plan;
}

/** A customer with an approved plan for the E2E coach, and two PT sessions on one day (10:00 and 12:00). */
export async function sessionsWithPlan(
  apiAs: ApiAs,
  tag: string,
  sessions = 2,
): Promise<{
  customer: Awaited<ReturnType<typeof bookingSetup>>["customer"];
  catalog: Awaited<ReturnType<typeof workoutCatalog>>;
  day: ReturnType<typeof randomBookingDay>;
  bookings: [string, string];
}> {
  const { customer, refs } = await bookingSetup(apiAs, tag);
  // The coach is the employee the PT login belongs to, so the PT owns these sessions.
  const { employeeId: trainerId } = (await (await (await apiAs("PT")).get("/api/v1/me")).json()) as {
    employeeId: string;
  };
  const catalog = await workoutCatalog(apiAs, tag);
  await approvedPlanViaApi(apiAs, { customerId: customer.id, contractId: refs.contractId, trainerId }, catalog, tag);
  const reception = await apiAs("RECEPTIONIST");
  const day = randomBookingDay();
  const first = await createBookingViaApi(
    reception,
    { ...refs, trainerId },
    { date: day.date, startTime: "10:00", endTime: "11:00" },
  );
  const second =
    sessions > 1
      ? await createBookingViaApi(
          reception,
          { ...refs, trainerId },
          { date: day.date, startTime: "12:00", endTime: "13:00" },
        )
      : first;
  return { customer, catalog, day, bookings: [first.id, second.id] };
}

/**
 * Opens the log of a session as the manager and saves it with a Flag and an Action on the first set of its first exercise
 * (codes of the option lists, A-191), a stress of 6 before and an sRPE of 8 after. Returns the log's id.
 */
export async function loggedSession(
  apiAs: ApiAs,
  bookingId: string,
  codes: { flag: string; action: string },
): Promise<string> {
  const manager = await apiAs("FITNESS_MANAGER");
  const opened = await manager.post("/api/v1/workout/logs", { data: { bookingId } });
  expect(opened.status(), "open log").toBe(201);
  const log = (await opened.json()) as {
    id: string;
    goal: string | null;
    items: {
      id: string;
      exercise: { id: string };
      sets: { id: string; weight: number | null; reps: number | null }[];
    }[];
  };
  const idOf = async (list: string, code: string) => {
    const { items } = (await (await manager.get(`/api/v1/option-lists/${list}/options`)).json()) as {
      items: { id: string; code: string | null }[];
    };
    return items.find((option) => option.code === code)!.id;
  };
  const flagId = await idOf("workoutFlags", codes.flag);
  const actionId = await idOf("workoutActions", codes.action);
  const none = await idOf("workoutActions", "NONE");
  const normal = await idOf("workoutFlags", "NORMAL");
  const saved = await manager.put(`/api/v1/workout/logs/${log.id}`, {
    data: {
      goal: log.goal,
      preStress: 6,
      postSrpe: 8,
      items: log.items.map((item, itemIndex) => ({
        id: item.id,
        exerciseId: item.exercise.id,
        sets: item.sets.map((set, setIndex) => ({
          id: set.id,
          weight: set.weight,
          reps: set.reps,
          flagId: itemIndex === 0 && setIndex === 0 ? flagId : normal,
          actionId: itemIndex === 0 && setIndex === 0 ? actionId : none,
        })),
      })),
    },
  });
  expect(saved.status(), "save log").toBe(200);
  return log.id;
}
