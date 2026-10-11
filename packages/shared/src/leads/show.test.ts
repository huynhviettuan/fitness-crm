import { describe, expect, it } from "vitest";
import { showInputSchema } from "./show.schema.js";
import { checklistInputSchema, type ChecklistInput } from "./checklist.schema.js";

const fieldErrors = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));

const valid = {
  idDocumentType: "CCCD",
  idDocumentNumber: "0792 0100 1234",
  birthDate: "15/03/1990",
  nationality: " Việt Nam ",
  email: " An@Example.com ",
  phone: "0909 123 456",
  consent: true,
};

describe("showInputSchema (D-019, D-036, D-042)", () => {
  it("needs the ID document, birth date, nationality, email, phone, and consent", () => {
    expect(showInputSchema.parse(valid)).toEqual({
      idDocumentType: "CCCD",
      idDocumentNumber: "079201001234",
      birthDate: new Date(Date.UTC(1990, 2, 15)),
      nationality: "Việt Nam",
      email: "an@example.com",
      phone: "0909123456",
      healthNote: null,
      consent: true,
    });
    expect(fieldErrors(showInputSchema.safeParse({}))).toMatchObject({
      idDocumentType: "invalidChoice",
      birthDate: expect.any(String),
      nationality: expect.any(String),
      email: expect.any(String),
      phone: expect.any(String),
      consent: "consentRequired",
    });
    expect(fieldErrors(showInputSchema.safeParse({ ...valid, consent: false }))).toEqual({
      consent: "consentRequired",
    });
  });

  it("takes a CCCD of 12 digits, or a passport of 6 to 20 letters and digits", () => {
    expect(fieldErrors(showInputSchema.safeParse({ ...valid, idDocumentNumber: "12345" }))).toEqual({
      idDocumentNumber: "invalidIdDocument",
    });
    expect(
      showInputSchema.parse({ ...valid, idDocumentType: "PASSPORT", idDocumentNumber: "b-1234567" }).idDocumentNumber,
    ).toBe("B1234567");
    expect(
      fieldErrors(showInputSchema.safeParse({ ...valid, idDocumentType: "PASSPORT", idDocumentNumber: "B12" })),
    ).toEqual({
      idDocumentNumber: "invalidIdDocument",
    });
  });

  it("refuses a birth date in the future and control characters in the health note", () => {
    expect(
      fieldErrors(showInputSchema.safeParse({ ...valid, birthDate: "01/01/2999", healthNote: "a\u0000" })),
    ).toEqual({
      birthDate: "invalidDate",
      healthNote: "invalidCharacters",
    });
  });
});

describe("result effects (M2 slice 4)", () => {
  const step = (results: ChecklistInput["steps"][number]["results"]) => ({
    key: "show",
    labelVi: "Show",
    labelEn: "Show",
    trigger: "APPOINTMENT" as const,
    offsetValue: 0,
    offsetUnit: "MINUTES" as const,
    results,
  });

  it("gives each result at most one effect per step", () => {
    const parsed = checklistInputSchema.parse({
      steps: [
        step([
          { labelVi: "Show", labelEn: "Show", effect: "SHOW" },
          { labelVi: "No show", labelEn: "No show", effect: "NO_SHOW" },
        ]),
      ],
    });
    expect(parsed.steps[0].results.map((result) => result.effect)).toEqual(["SHOW", "NO_SHOW"]);
    expect(
      fieldErrors(
        checklistInputSchema.safeParse({
          steps: [
            step([
              { labelVi: "A", labelEn: "A", effect: "SHOW" },
              { labelVi: "B", labelEn: "B", effect: "SHOW" },
            ]),
          ],
        }),
      ),
    ).toEqual({ "steps.0.results": "duplicate" });
    expect(
      checklistInputSchema.parse({ steps: [step([{ labelVi: "Done", labelEn: "Done" }])] }).steps[0].results[0].effect,
    ).toBeNull();
  });
});
