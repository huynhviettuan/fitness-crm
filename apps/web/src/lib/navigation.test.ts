import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, buildNav, groupOf, type NavItemKey } from "./navigation";

const everything = NAV_SECTIONS.flatMap(({ entries }) =>
  entries.flatMap((entry) => (typeof entry === "string" ? [entry] : [...entry.items])),
) as NavItemKey[];

describe("buildNav", () => {
  it("shows every group to someone who may see everything", () => {
    const sections = buildNav(everything);

    expect(sections.map((section) => section.label)).toEqual(["main", "administration"]);
    expect(sections[0]!.nodes.map((node) => (node.kind === "group" ? `group:${node.key}` : node.key))).toEqual([
      "dashboard",
      "group:leads",
      "group:customers",
      "group:schedule",
      "group:workouts",
      "tasks",
      "finance",
      "group:reports",
    ]);
    expect(sections[1]!.nodes.map((node) => node.key)).toEqual(["people", "config", "monitoring"]);
  });

  it("leaves out a group with no visible item and an empty section", () => {
    expect(buildNav(["dashboard", "tasks"])).toEqual([
      {
        label: "main",
        nodes: [
          { kind: "item", key: "dashboard" },
          { kind: "item", key: "tasks" },
        ],
      },
    ]);
  });

  it("shows a group with one visible item as that item", () => {
    const [main] = buildNav(["leads", "consultingReport"]);

    expect(main!.nodes).toEqual([
      { kind: "item", key: "leads" },
      { kind: "item", key: "consultingReport" },
    ]);
  });

  it("keeps the order of the structure, not the order it was given", () => {
    const [main] = buildNav(["leadsAudit", "leads", "leadsToday"]);

    expect(main!.nodes).toEqual([{ kind: "group", key: "leads", items: ["leads", "leadsToday", "leadsAudit"] }]);
  });

  it("lists every item once", () => {
    expect(new Set(everything).size).toBe(everything.length);
  });
});

describe("groupOf", () => {
  it("names the group that holds an item, and nothing for a plain item", () => {
    expect(groupOf("leadsToday")).toBe("leads");
    expect(groupOf("trash")).toBe("monitoring");
    expect(groupOf("dashboard")).toBeUndefined();
  });
});
