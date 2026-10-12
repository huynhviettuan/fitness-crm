import { describe, expect, it } from "vitest";
import { pagingHref, readPaging } from "./paging";

describe("readPaging", () => {
  it("defaults to the first page of 10", () => {
    expect(readPaging({})).toEqual({ page: 1, pageSize: 10 });
  });

  it("reads a valid page and size", () => {
    expect(readPaging({ page: "3", pageSize: "50" })).toEqual({ page: 3, pageSize: 50 });
  });

  it("ignores malformed values and sizes that are not offered", () => {
    expect(readPaging({ page: "-2", pageSize: "7" })).toEqual({ page: 1, pageSize: 10 });
    expect(readPaging({ page: "abc", pageSize: "1000" })).toEqual({ page: 1, pageSize: 10 });
    expect(readPaging({ page: ["4", "5"] })).toEqual({ page: 4, pageSize: 10 });
  });
});

describe("pagingHref", () => {
  it("leaves default values out", () => {
    expect(pagingHref("/customers", {}, 1, 10)).toBe("/customers");
  });

  it("keeps filters and replaces paging", () => {
    expect(pagingHref("/customers", { q: "an", page: "2", pageSize: "50" }, 3, 50)).toBe(
      "/customers?q=an&pageSize=50&page=3",
    );
  });

  it("drops empty filters and goes back to page 1 without a page parameter", () => {
    expect(pagingHref("/tasks", { view: "mine", q: "", page: "4" }, 1, 20)).toBe("/tasks?view=mine&pageSize=20");
  });
});

describe("a second list on the same screen", () => {
  const keys = { page: "queuePage", pageSize: "queueSize" };

  it("reads its own parameters and ignores the first list's", () => {
    expect(readPaging({ page: "3", pageSize: "50", queuePage: "2", queueSize: "20" }, keys)).toEqual({
      page: 2,
      pageSize: 20,
    });
    expect(readPaging({ page: "3", pageSize: "50" }, keys)).toEqual({ page: 1, pageSize: 10 });
  });

  it("links keep the other list's paging and replace its own", () => {
    expect(pagingHref("/leads/audit", { page: "3", queuePage: "2" }, 4, 20, keys)).toBe(
      "/leads/audit?page=3&queueSize=20&queuePage=4",
    );
    expect(pagingHref("/leads/audit", { page: "3", queuePage: "2" }, 1, 10, keys)).toBe("/leads/audit?page=3");
  });
});
