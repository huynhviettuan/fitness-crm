import { describe, expect, it } from "vitest";
import { pageWindow } from "./table-pagination";

describe("pageWindow", () => {
  it("shows every page when there are few", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
  });

  it("keeps the first and last page and marks gaps", () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });

  it("does not mark a gap of a single page", () => {
    expect(pageWindow(3, 10)).toEqual([1, 2, 3, 4, null, 10]);
  });
});

describe("the jump to a page", () => {
  it("can make a link for any page from one template", async () => {
    const { PAGE_PLACEHOLDER, pagingHref } = await import("@/lib/paging");
    const template = pagingHref("/contracts", { q: "an", pageSize: "20" }, PAGE_PLACEHOLDER, 20);
    expect(template).toContain(`page=${PAGE_PLACEHOLDER}`);
    expect(template.replace(String(PAGE_PLACEHOLDER), "7")).toBe("/contracts?q=an&pageSize=20&page=7");
  });
});
