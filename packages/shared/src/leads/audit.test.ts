import { describe, expect, it } from "vitest";
import {
  addTotals,
  auditLead,
  checkPriority,
  compliancePercent,
  criterionResult,
  dueSteps,
  EMPTY_TOTALS,
  journeyWentPast,
  scorePercent,
  stepOutcome,
  type CriterionConfig,
} from "./audit.domain.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const before = new Date("2026-10-12T09:00:00Z");
const after = new Date("2026-10-12T11:00:00Z");
const FIELDS = { needGroup: true, phone: true, refuseReason: false, status: "CONSULTING" as const };
const ALL_ON: CriterionConfig[] = [
  { key: "needGroup", active: true, weight: 1 },
  { key: "phone", active: true, weight: 1 },
  { key: "refuseReason", active: true, weight: 1 },
];

describe("stepOutcome (A-081)", () => {
  it("is on time when done by the deadline and late when done after it, as the step recorded", () => {
    expect(stepOutcome({ dueAt: after, doneAt: before, timing: "ON_TIME" }, false, NOW)).toBe("ON_TIME");
    expect(stepOutcome({ dueAt: before, doneAt: NOW, timing: "LATE" }, false, NOW)).toBe("LATE");
    // A step with no deadline that was done counts as on time.
    expect(stepOutcome({ dueAt: null, doneAt: NOW, timing: "ON_TIME" }, false, NOW)).toBe("ON_TIME");
  });

  it("is late when still open past the deadline, and skipped when the journey went past it", () => {
    const open = { dueAt: before, doneAt: null, timing: null };

    expect(stepOutcome(open, false, NOW)).toBe("LATE");
    expect(stepOutcome(open, true, NOW)).toBe("SKIPPED");
  });

  it("counts for nothing while waiting for its trigger or before its deadline", () => {
    expect(stepOutcome({ dueAt: null, doneAt: null, timing: null }, false, NOW)).toBeNull();
    expect(stepOutcome({ dueAt: after, doneAt: null, timing: null }, false, NOW)).toBeNull();
    expect(stepOutcome({ dueAt: after, doneAt: null, timing: null }, true, NOW)).toBeNull();
  });

  it("counts a deadline of exactly now as not yet due", () => {
    expect(stepOutcome({ dueAt: NOW, doneAt: null, timing: null }, false, NOW)).toBeNull();
  });
});

describe("stepOutcome with a locked step (D-054)", () => {
  it('counts a step locked as "Không thực hiện" as skipped, whatever the journey did next', () => {
    const due = new Date(NOW.getTime() - 3 * 3_600_000);
    const lockedAt = new Date(NOW.getTime() - 1 * 3_600_000);

    expect(stepOutcome({ dueAt: due, doneAt: null, timing: null, lockedAt }, false, NOW)).toBe("SKIPPED");
    expect(stepOutcome({ dueAt: due, doneAt: null, timing: null, lockedAt }, true, NOW)).toBe("SKIPPED");
    // Open and still inside the grace period: late, not skipped, unless the journey went past.
    expect(stepOutcome({ dueAt: due, doneAt: null, timing: null, lockedAt: null }, false, NOW)).toBe("LATE");
  });
});

describe("journeyWentPast", () => {
  it("is true for customers and for shown or contracted leads only", () => {
    expect(journeyWentPast("SHOWED", "LEAD")).toBe(true);
    expect(journeyWentPast("CONTRACTED", "LEAD")).toBe(true);
    expect(journeyWentPast("CONSULTING", "CUSTOMER")).toBe(true);
    for (const status of ["NEW", "CONSULTING", "CONSIDERING", "NO_RESPONSE", "BOOKED", "NO_SHOW", "REFUSED"] as const) {
      expect(journeyWentPast(status, "LEAD")).toBe(false);
    }
    expect(journeyWentPast(null, "LEAD")).toBe(false);
  });
});

describe("criterionResult (A-083)", () => {
  it("looks at the need group and phone of every lead, and the refusal reason of a refused one", () => {
    expect(criterionResult("needGroup", { ...FIELDS, needGroup: false })).toEqual({ applies: true, passed: false });
    expect(criterionResult("phone", FIELDS)).toEqual({ applies: true, passed: true });
    expect(criterionResult("refuseReason", FIELDS)).toEqual({ applies: false, passed: false });
    expect(criterionResult("refuseReason", { ...FIELDS, status: "REFUSED" })).toEqual({
      applies: true,
      passed: false,
    });
  });
});

describe("auditLead (A-082)", () => {
  it("adds one check per due step and one per applying active criterion", () => {
    const { totals, failed } = auditLead(["ON_TIME", "LATE", null, "SKIPPED"], FIELDS, ALL_ON);

    expect(totals).toEqual({ onTime: 1, late: 1, skipped: 1, passedWeight: 3, totalWeight: 5 });
    expect(failed).toEqual([]);
    expect(compliancePercent(totals)).toBe(33);
    expect(scorePercent(totals)).toBe(60);
  });

  it("fails a criterion whose field is missing, by its weight", () => {
    const criteria: CriterionConfig[] = [{ key: "needGroup", active: true, weight: 4 }, ...ALL_ON.slice(1)];

    const { totals, failed } = auditLead(["ON_TIME"], { ...FIELDS, needGroup: false }, criteria);

    expect(failed).toEqual(["needGroup"]);
    expect(totals).toMatchObject({ passedWeight: 2, totalWeight: 6 });
    expect(scorePercent(totals)).toBe(33);
  });

  it("leaves an inactive criterion out of the score at once", () => {
    const off = ALL_ON.map((criterion) =>
      criterion.key === "needGroup" ? { ...criterion, active: false } : criterion,
    );

    const { totals, failed } = auditLead(["ON_TIME"], { ...FIELDS, needGroup: false }, off);

    expect(failed).toEqual([]);
    expect(scorePercent(totals)).toBe(100);
  });

  it("has no score when there is nothing to check", () => {
    const { totals } = auditLead([], FIELDS, []);

    expect(scorePercent(totals)).toBeNull();
    expect(compliancePercent(totals)).toBeNull();
  });
});

describe("totals", () => {
  it("add up across leads, so a consultant's figures are not an average of lead scores", () => {
    const small = auditLead(["ON_TIME"], FIELDS, []).totals;
    const big = auditLead(["LATE", "LATE", "LATE", "LATE"], FIELDS, []).totals;

    const total = addTotals(small, big);

    expect(dueSteps(total)).toBe(5);
    expect(compliancePercent(total)).toBe(20);
    // The average of the two lead scores (100 and 0) would be 50.
    expect(scorePercent(total)).toBe(20);
    expect(addTotals(EMPTY_TOTALS, EMPTY_TOTALS)).toEqual(EMPTY_TOTALS);
  });

  it("order the leads to check by late and skipped steps plus the weight of failed criteria", () => {
    const lateTwice = auditLead(["LATE", "LATE"], FIELDS, []).totals;
    const onTime = auditLead(["ON_TIME"], FIELDS, []).totals;

    expect(checkPriority(lateTwice, 0)).toBe(2);
    expect(checkPriority(onTime, 3)).toBe(3);
    expect(checkPriority(onTime, 0)).toBe(0);
  });
});
