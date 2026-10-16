import { describe, expect, it } from "vitest";
import { TURN_SCALE, takeTurn, workingMinutesBetween, type TurnCandidate } from "./assignment.domain.js";

const TZ = "Asia/Ho_Chi_Minh";
const WINDOW = { start: "08:30", end: "20:30" };
// 2026-10-12 is a Monday; Vietnam is UTC+7, so 08:30 there is 01:30 UTC.
const at = (day: number, time: string) => new Date(`2026-10-${String(day).padStart(2, "0")}T${time}:00+07:00`);

/** Deals `count` leads to people with these weights, carrying the virtual times like the API does. */
function deal(weights: Record<string, number>, count: number, away: string[] = []): string[] {
  const order = Object.keys(weights);
  const vtimes: Record<string, bigint> = {};
  const result: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const latest = Object.values(vtimes).reduce((max, v) => (v > max ? v : max), 0n);
    const candidates: TurnCandidate[] = order
      .filter((id) => !away.includes(id))
      .map((id) => ({ id, weight: weights[id], vtime: vtimes[id] ?? latest }));
    const turn = takeTurn(candidates, latest)!;
    Object.assign(vtimes, turn.vtimes);
    result.push(turn.chosen);
  }
  return result;
}

describe("takeTurn (D-050)", () => {
  it("goes round in the given order when everybody has weight 1", () => {
    expect(deal({ a: 1, b: 1, c: 1 }, 7)).toEqual(["a", "b", "c", "a", "b", "c", "a"]);
  });

  it("gives a full-timer with weight 2 two leads in each round of three, and a part-timer one", () => {
    const dealt = deal({ full: 2, part: 1 }, 9);
    expect(dealt.filter((id) => id === "full")).toHaveLength(6);
    expect(dealt.filter((id) => id === "part")).toHaveLength(3);
    // Every round of three has the same share, not six in a row for one of them.
    for (let round = 0; round < 3; round += 1) {
      expect(dealt.slice(round * 3, round * 3 + 3).filter((id) => id === "full")).toHaveLength(2);
    }
    expect(dealt.slice(0, 6)).toEqual(["full", "part", "full", "full", "part", "full"]);
  });

  it("keeps the shares of weights 3, 2 and 1 over a long run", () => {
    const dealt = deal({ a: 3, b: 2, c: 1 }, 60);
    expect(dealt.filter((id) => id === "a")).toHaveLength(30);
    expect(dealt.filter((id) => id === "b")).toHaveLength(20);
    expect(dealt.filter((id) => id === "c")).toHaveLength(10);
  });

  it("carries on in order when someone leaves, and takes them back without a flood of leads", () => {
    const credits: Record<string, bigint> = {};
    const turn = (ids: string[]) => {
      const latest = Object.values(credits).reduce((max, v) => (v > max ? v : max), 0n);
      const result = takeTurn(
        ids.map((id) => ({ id, weight: 1, vtime: credits[id] ?? latest })),
        latest,
      )!;
      Object.assign(credits, result.vtimes);
      return result.chosen;
    };
    expect([turn(["a", "b", "c"]), turn(["a", "b", "c"])]).toEqual(["a", "b"]);
    // b leaves: c, who has had none, is next, then a again.
    expect([turn(["a", "c"]), turn(["a", "c"])]).toEqual(["c", "a"]);
    // A long absence: after 20 leads for the others, c comes back and gets one, not twenty.
    for (let n = 0; n < 20; n += 1) turn(["a", "b"]);
    const back = Array.from({ length: 6 }, () => turn(["a", "b", "c"]));
    expect(back.filter((id) => id === "c").length).toBeLessThanOrEqual(3);
    expect(back.filter((id) => id === "c").length).toBeGreaterThanOrEqual(1);
  });

  it("starts a newcomer level with the others, not far behind them", () => {
    const dealt = deal({ a: 1, b: 1 }, 10);
    expect(dealt.filter((id) => id === "a")).toHaveLength(5);
    const vtimes: Record<string, bigint> = { a: 5n * TURN_SCALE, b: 5n * TURN_SCALE };
    const next = takeTurn(
      [
        { id: "a", weight: 1, vtime: vtimes.a },
        { id: "b", weight: 1, vtime: vtimes.b },
        { id: "new", weight: 1, vtime: 5n * TURN_SCALE },
      ],
      5n * TURN_SCALE,
    )!;
    expect(next.chosen).toBe("a");
  });

  it("has no one to choose from when there are no candidates, and returns new times without changing the old", () => {
    expect(takeTurn([], 0n)).toBeNull();
    const candidates: TurnCandidate[] = [{ id: "a", weight: 1, vtime: 0n }];
    expect(takeTurn(candidates, 0n)?.chosen).toBe("a");
    expect(candidates[0].vtime).toBe(0n);
  });
});

describe("workingMinutesBetween (D-052)", () => {
  it("counts the minutes inside the window of one day", () => {
    expect(workingMinutesBetween(at(12, "10:00"), at(12, "11:15"), WINDOW, TZ)).toBe(75);
  });

  it("does not count time before the window opens or after it closes", () => {
    expect(workingMinutesBetween(at(12, "07:00"), at(12, "09:00"), WINDOW, TZ)).toBe(30);
    expect(workingMinutesBetween(at(12, "20:00"), at(12, "23:00"), WINDOW, TZ)).toBe(30);
  });

  it("stops the clock at night and runs it on the next morning: 30 minutes at 20:00, 30 more from 08:30", () => {
    expect(workingMinutesBetween(at(12, "20:00"), at(13, "08:30"), WINDOW, TZ)).toBe(30);
    expect(workingMinutesBetween(at(12, "20:00"), at(13, "09:00"), WINDOW, TZ)).toBe(60);
    expect(workingMinutesBetween(at(12, "20:00"), at(13, "09:30"), WINDOW, TZ)).toBe(90);
  });

  it("counts whole days in between, and nothing for a lead that waits only outside the window", () => {
    expect(workingMinutesBetween(at(12, "08:30"), at(14, "20:30"), WINDOW, TZ)).toBe(3 * 12 * 60);
    expect(workingMinutesBetween(at(12, "21:00"), at(13, "08:00"), WINDOW, TZ)).toBe(0);
  });

  it("counts nothing when the end is not after the start", () => {
    expect(workingMinutesBetween(at(12, "10:00"), at(12, "10:00"), WINDOW, TZ)).toBe(0);
    expect(workingMinutesBetween(at(12, "11:00"), at(12, "10:00"), WINDOW, TZ)).toBe(0);
  });

  it("follows a changed window", () => {
    expect(workingMinutesBetween(at(12, "06:00"), at(12, "23:00"), { start: "06:00", end: "22:00" }, TZ)).toBe(16 * 60);
  });
});
