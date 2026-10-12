import { calendarDateInTimeZone, instantAt } from "../validation/index.js";

// How leads are shared between consultants and taken back (D-050, D-052). Pure rules; the
// database, the clock, and the people are the API's business.

const DAY_MS = 86_400_000;

/** How a lead was given to its consultant (D-050, D-052). */
export const ASSIGNMENT_KINDS = ["ROUND_ROBIN", "MANUAL", "RECLAIM"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

/** The unit of virtual time: the least common multiple of the weights 1 to 20, so each step is exact. */
export const TURN_SCALE = 232_792_560n;

/** One person who may get the next lead: their turn weight and where they stand in virtual time. */
export type TurnCandidate = { id: string; weight: number; vtime: bigint };

/**
 * A weighted round-robin (D-050, weighted fair queuing): each person has a virtual time that
 * grows by `TURN_SCALE / weight` every time they take a lead, and the one with the least takes
 * the next, the first in the list on a tie, so people come in their fixed order. With weights
 * 2 and 1 the turns go A, B, A, A, B, A; with equal weights they go round in order. Someone who
 * was away, or is new, starts no further back than one round before `latest`, the highest virtual
 * time of the branch, so coming back is never a flood of leads. When someone leaves the rotation the
 * others carry on in order. Returns the person chosen and the new virtual time of every candidate;
 * nothing is changed in place.
 */
export function takeTurn(
  candidates: readonly TurnCandidate[],
  latest: bigint,
): { chosen: string; vtimes: Record<string, bigint> } | null {
  if (candidates.length === 0) return null;
  const floor = latest - TURN_SCALE;
  const vtimes: Record<string, bigint> = {};
  let chosen = candidates[0];
  for (const candidate of candidates) {
    vtimes[candidate.id] = candidate.vtime < floor ? floor : candidate.vtime;
    if (vtimes[candidate.id] < vtimes[chosen.id]) chosen = candidate;
  }
  vtimes[chosen.id] += TURN_SCALE / BigInt(chosen.weight);
  return { chosen: chosen.id, vtimes };
}

/** The consultants' working window, "HH:mm" to "HH:mm" of the gym's day (D-052). */
export type WorkingWindow = { start: string; end: string };

/**
 * Whole minutes between two instants that fall inside the working window of each gym day
 * (D-052): the clock stops outside it and runs on the next morning. A lead that arrives at
 * 20:00 with a window to 20:30 has waited 30 minutes at 08:30 the next day… and 60 at 09:00.
 * `to` before `from` is nothing. Days are gym-local, so the time zone must not shift its
 * clock (Vietnam has no daylight saving time).
 */
export function workingMinutesBetween(from: Date, to: Date, window: WorkingWindow, timeZone: string): number {
  if (to.getTime() <= from.getTime()) return 0;
  let total = 0;
  const lastDay = calendarDateInTimeZone(timeZone, to).getTime();
  for (let day = calendarDateInTimeZone(timeZone, from).getTime(); day <= lastDay; day += DAY_MS) {
    const date = new Date(day);
    const opens = Math.max(instantAt(date, window.start, timeZone).getTime(), from.getTime());
    const closes = Math.min(instantAt(date, window.end, timeZone).getTime(), to.getTime());
    if (closes > opens) total += closes - opens;
  }
  return Math.floor(total / 60_000);
}
