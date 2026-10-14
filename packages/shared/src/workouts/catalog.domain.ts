// Workout catalogs (M7.1, brief §7.1, FR-WKO-001, D-033; A-188 to A-191): pure rules shared by the API, the screens and the tests.

/** An exercise is Strength (weight, reps, rest, RIR, tempo) or Cardio (time, speed, heart rate); Cardio is a kind of exercise in the catalog, not a part of the plan (brief §7.1). */
export const EXERCISE_KINDS = ["STRENGTH", "CARDIO"] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

/** How deep the body-area tree may go: deep enough for area, region, muscle group, and muscle. */
export const MAX_AREA_DEPTH = 5;

type Node = { id: string; parentId: string | null };

/** Every area below `id`, at any depth. */
export function descendantIds(areas: readonly Node[], id: string): string[] {
  const found: string[] = [];
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const area of areas) {
      if (area.parentId === current && !found.includes(area.id)) {
        found.push(area.id);
        queue.push(area.id);
      }
    }
  }
  return found;
}

/** Whether moving `id` under `parentId` would make the tree loop back on itself: under itself, or under its own descendant. */
export function wouldCycle(areas: readonly Node[], id: string, parentId: string | null): boolean {
  if (parentId === null) return false;
  return parentId === id || descendantIds(areas, id).includes(parentId);
}

/** The levels from the top down to `id`, counting `id` (a top-level area is 1). Zero when it is not in the list. */
export function depthOf(areas: readonly Node[], id: string): number {
  let depth = 0;
  let current: string | null = id;
  const seen = new Set<string>();
  while (current !== null) {
    const area = areas.find((candidate) => candidate.id === current);
    if (!area || seen.has(area.id)) return depth;
    seen.add(area.id);
    depth += 1;
    current = area.parentId;
  }
  return depth;
}

/** The levels below `id`, not counting `id` (an area with no children is 0). */
export function heightOf(areas: readonly Node[], id: string): number {
  const children = areas.filter((area) => area.parentId === id);
  return children.length === 0 ? 0 : 1 + Math.max(...children.map((child) => heightOf(areas, child.id)));
}

/** The names from the top down, e.g. "Thân dưới › Đùi › Đùi trước". */
export function areaPath(areas: readonly (Node & { name: string })[], id: string): string {
  const names: string[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current !== null) {
    const area = areas.find((candidate) => candidate.id === current);
    if (!area || seen.has(area.id)) break;
    seen.add(area.id);
    names.unshift(area.name);
    current = area.parentId;
  }
  return names.join(" › ");
}

/**
 * The codes of the entries of the workout option lists that the log's defaults and rules rely on (brief §7.3, §7.4): a
 * set starts as Flag Normal and Action None, and "Stop + Escalation" notifies the manager and the Master. Admin may
 * rename and reorder the entries; the codes are what the code finds them by.
 */
export const WORKOUT_CODES = {
  flagNormal: "NORMAL",
  actionNone: "NONE",
  actionStopEscalation: "STOP_ESCALATION",
} as const;
