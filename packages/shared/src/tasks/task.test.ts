import { describe, expect, it } from "vitest";
import { listTasksSchema, taskCommentSchema, taskInputSchema, taskUpdateSchema } from "./task.schema.js";

const USER = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const DEPARTMENT = "3d4e5f6a-7b8c-4d9e-8f0a-2b3c4d5e6f7a";

const fieldErrors = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));

describe("taskInputSchema (brief §8.2)", () => {
  it("takes a person, a deadline, and defaults to normal priority with no record", () => {
    expect(
      taskInputSchema.parse({ title: " Gọi lại khách ", assigneeUserId: USER, dueDate: "20/10/2026", dueTime: "9:00" }),
    ).toEqual({
      title: "Gọi lại khách",
      description: null,
      assigneeUserId: USER,
      assigneeDepartmentId: null,
      dueDate: new Date(Date.UTC(2026, 9, 20)),
      dueTime: "09:00",
      priority: "NORMAL",
      entityType: null,
      entityId: null,
    });
  });

  it("needs exactly one assignee: a person or a department", () => {
    const base = { title: "A", dueDate: "20/10/2026", dueTime: "09:00" };
    expect(fieldErrors(taskInputSchema.safeParse(base))).toEqual({ assigneeUserId: "required" });
    expect(
      fieldErrors(taskInputSchema.safeParse({ ...base, assigneeUserId: USER, assigneeDepartmentId: DEPARTMENT })),
    ).toEqual({
      assigneeDepartmentId: "oneAssigneeOnly",
    });
    expect(taskUpdateSchema.safeParse({ ...base, assigneeDepartmentId: DEPARTMENT }).success).toBe(true);
  });

  it("links a record only with both its type and id", () => {
    const base = { title: "A", assigneeUserId: USER, dueDate: "20/10/2026", dueTime: "09:00" };
    expect(fieldErrors(taskInputSchema.safeParse({ ...base, entityType: "customer" }))).toEqual({
      entityId: "invalidChoice",
    });
    expect(fieldErrors(taskInputSchema.safeParse({ ...base, entityType: "booking", entityId: USER }))).toEqual({
      entityType: "invalidChoice",
    });
    expect(taskInputSchema.parse({ ...base, entityType: "contract", entityId: USER })).toMatchObject({
      entityType: "contract",
      entityId: USER,
    });
  });

  it("rejects a missing title, a bad deadline, and an unknown priority", () => {
    expect(
      fieldErrors(
        taskInputSchema.safeParse({
          title: " ",
          assigneeUserId: USER,
          dueDate: "31/02/2026",
          dueTime: "25:00",
          priority: "URGENT",
        }),
      ),
    ).toEqual({
      title: "required",
      dueDate: "invalidDate",
      dueTime: "invalidTime",
      priority: "invalidChoice",
    });
  });
});

describe("listTasksSchema and taskCommentSchema", () => {
  it("defaults to my tasks and reads flags from the query string", () => {
    expect(listTasksSchema.parse({ overdueOnly: "true", status: "" })).toMatchObject({
      view: "mine",
      overdueOnly: true,
      status: undefined,
      page: 1,
    });
    expect(listTasksSchema.safeParse({ view: "everyone" }).success).toBe(false);
  });

  it("needs a comment body and takes mentioned people", () => {
    expect(taskCommentSchema.parse({ body: " Đã gọi " })).toEqual({ body: "Đã gọi", mentions: [] });
    expect(fieldErrors(taskCommentSchema.safeParse({ body: "", mentions: ["x"] }))).toEqual({
      body: "required",
      "mentions.0": "invalidChoice",
    });
  });
});
