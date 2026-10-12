import { describe, expect, it } from "vitest";
import { reportQuerySchema } from "./report.schema.js";
import {
  EMPTY_FUNNEL,
  EMPTY_STEP,
  addPerson,
  addStep,
  cohortRates,
  funnelRates,
  median,
  percent,
  recareOutcome,
  type PersonFacts,
} from "./report.domain.js";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 5, hour));
const NOTHING: PersonFacts = {
  consulted: false,
  booked: false,
  showed: false,
  contracted: false,
  recareEntered: false,
  recareRebooked: false,
  firstResponseMinutes: null,
};

describe("recareOutcome (A-091)", () => {
  it("is not in re-care without a No response, Refused, or No show", () => {
    expect(recareOutcome([])).toEqual({ entered: false, rebooked: false });
    expect(recareOutcome([{ toStatus: "BOOKED", changedAt: at(1) }])).toEqual({ entered: false, rebooked: false });
  });

  it("enters re-care at the first such status, and is booked again only by a Booked after it", () => {
    expect(recareOutcome([{ toStatus: "NO_SHOW", changedAt: at(2) }])).toEqual({ entered: true, rebooked: false });
    expect(
      recareOutcome([
        { toStatus: "BOOKED", changedAt: at(1) },
        { toStatus: "NO_SHOW", changedAt: at(2) },
        { toStatus: "BOOKED", changedAt: at(3) },
      ]),
    ).toEqual({ entered: true, rebooked: true });
    // A booking before the first entry does not count as booked again.
    expect(
      recareOutcome([
        { toStatus: "BOOKED", changedAt: at(1) },
        { toStatus: "REFUSED", changedAt: at(2) },
      ]),
    ).toEqual({ entered: true, rebooked: false });
  });

  it("takes the earliest entry whatever the order of the changes", () => {
    expect(
      recareOutcome([
        { toStatus: "BOOKED", changedAt: at(5) },
        { toStatus: "NO_RESPONSE", changedAt: at(2) },
      ]),
    ).toEqual({ entered: true, rebooked: true });
  });
});

describe("percent and median", () => {
  it("round to whole percentages, and are null with nothing to divide by", () => {
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 4)).toBe(0);
    expect(percent(1, 0)).toBeNull();
  });

  it("take the middle value, the mean of the two middle ones for an even count, and none for none", () => {
    expect(median([])).toBeNull();
    expect(median([30])).toBe(30);
    expect(median([90, 30])).toBe(60);
    expect(median([5, 1, 9])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});

describe("the funnel (A-089)", () => {
  it("counts each stage on its own, since a walk-in can show without a booking", () => {
    let totals = EMPTY_FUNNEL;
    totals = addPerson(totals, { ...NOTHING, consulted: true, booked: true, showed: true, contracted: true });
    totals = addPerson(totals, { ...NOTHING, showed: true });
    totals = addPerson(totals, { ...NOTHING, consulted: true, booked: true });
    totals = addPerson(totals, NOTHING);

    expect(totals).toMatchObject({ leads: 4, consulted: 2, booked: 2, showed: 2, contracted: 1 });
    expect(funnelRates(totals)).toMatchObject({ bookingRate: 50, showRate: 100 });
  });

  it("takes the median of the first responses that exist, and the re-care rate over those who entered", () => {
    let totals = EMPTY_FUNNEL;
    for (const minutes of [30, null, 90]) totals = addPerson(totals, { ...NOTHING, firstResponseMinutes: minutes });
    totals = addPerson(totals, { ...NOTHING, recareEntered: true, recareRebooked: true });
    totals = addPerson(totals, { ...NOTHING, recareEntered: true });

    expect(funnelRates(totals)).toMatchObject({ firstResponseMinutes: 60, recareRate: 50 });
    expect(funnelRates(EMPTY_FUNNEL)).toEqual({
      bookingRate: null,
      showRate: null,
      recareRate: null,
      firstResponseMinutes: null,
    });
  });

  it("does not change the totals it is given", () => {
    const before = addPerson(EMPTY_FUNNEL, NOTHING);

    addPerson(before, { ...NOTHING, booked: true, firstResponseMinutes: 5 });

    expect(before).toMatchObject({ leads: 1, booked: 0, responses: [] });
    expect(EMPTY_FUNNEL.leads).toBe(0);
  });
});

describe("reportQuerySchema", () => {
  it("leaves empty filters out and reads days as gym days", () => {
    const parsed = reportQuerySchema.parse({ from: "01/10/2026", to: "", branchId: "", staffId: "" });

    expect(parsed.from).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(parsed.to).toBeUndefined();
    expect(parsed.branchId).toBeUndefined();
  });

  it("refuses a day that does not exist and ids that are not ids", () => {
    for (const query of [{ from: "31/02/2026" }, { to: "x" }, { branchId: "x" }, { staffId: "x" }]) {
      expect(reportQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe("the steps of the checklist over the cohort (D-055)", () => {
  const facts = (over: Partial<PersonFacts>): PersonFacts => ({
    consulted: true,
    booked: false,
    showed: false,
    contracted: false,
    recareEntered: false,
    recareRebooked: false,
    firstResponseMinutes: null,
    ...over,
  });

  it("counts a step that is not due for nobody", () => {
    expect(addStep(EMPTY_STEP, null, false, facts({}))).toEqual(EMPTY_STEP);
  });

  it("counts due, done on time, done late, and not done, with the group each person falls in", () => {
    let totals = EMPTY_STEP;
    totals = addStep(totals, "ON_TIME", true, facts({ booked: true, showed: true, contracted: true }));
    totals = addStep(totals, "LATE", true, facts({ booked: true }));
    totals = addStep(totals, "SKIPPED", false, facts({}));
    // Open past its deadline and not done: due, and not done.
    totals = addStep(totals, "LATE", false, facts({ booked: true }));

    expect(totals).toMatchObject({ due: 4, done: 2, onTime: 1, late: 1, notDone: 2 });
    expect(totals.did).toEqual({ leads: 2, booked: 2, showed: 1, contracted: 1 });
    expect(totals.didNot).toEqual({ leads: 2, booked: 1, showed: 0, contracted: 0 });
  });

  it("turns a group into booked of the group, shown of the booked, contracted of the shown", () => {
    expect(cohortRates({ leads: 4, booked: 2, showed: 1, contracted: 1 })).toEqual({
      leads: 4,
      bookingRate: 50,
      showRate: 50,
      contractRate: 100,
    });
    expect(cohortRates({ leads: 0, booked: 0, showed: 0, contracted: 0 })).toEqual({
      leads: 0,
      bookingRate: null,
      showRate: null,
      contractRate: null,
    });
  });
});
