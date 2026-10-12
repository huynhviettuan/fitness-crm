/** The sidebar's structure (A-105): sections of plain items and collapsible groups. Pure, so it is tested without the UI. */

type Entry = string | { group: string; items: readonly string[] };

/**
 * Order is the order on screen. A new screen is added by adding its key to a group; which items a user sees is
 * decided by their permissions in the layout, and hiding an item is UX only (D-017).
 */
export const NAV_SECTIONS = [
  {
    label: "main",
    entries: [
      "dashboard",
      { group: "leads", items: ["leads", "leadsToday", "leadsRecare", "leadsAudit", "leadReceivers"] },
      { group: "customers", items: ["customers", "contracts"] },
      { group: "schedule", items: ["calendar", "sessions"] },
      "tasks",
      "finance",
      { group: "reports", items: ["consultingReport", "leadAnalysis"] },
    ],
  },
  {
    label: "administration",
    entries: [
      { group: "people", items: ["employees", "users", "roles", "branches", "approvalRules"] },
      { group: "config", items: ["services", "options", "parameters", "checklist", "auditCriteria", "scripts"] },
      { group: "monitoring", items: ["audit", "trash"] },
    ],
  },
] as const satisfies readonly { label: string; entries: readonly Entry[] }[];

type Entries = (typeof NAV_SECTIONS)[number]["entries"][number];

export type NavItemKey = Entries extends infer E
  ? E extends string
    ? E
    : E extends { items: readonly (infer I)[] }
      ? I
      : never
  : never;
export type NavGroupKey = Extract<Entries, { group: string }>["group"];
export type NavSectionLabel = (typeof NAV_SECTIONS)[number]["label"];

export type NavNode = { kind: "item"; key: NavItemKey } | { kind: "group"; key: NavGroupKey; items: NavItemKey[] };

export type NavSection = { label: NavSectionLabel; nodes: NavNode[] };

/**
 * What to render for the items a user may see: a group with no visible item is left out, and a group with a single
 * visible item is shown as that item, without a chevron. Sections left empty are dropped.
 */
export function buildNav(allowed: readonly NavItemKey[]): NavSection[] {
  const can = new Set<string>(allowed);
  return NAV_SECTIONS.map(({ label, entries }) => {
    const nodes = (entries as readonly Entry[]).flatMap((entry): NavNode[] => {
      if (typeof entry === "string") return can.has(entry) ? [{ kind: "item", key: entry as NavItemKey }] : [];
      const items = entry.items.filter((key) => can.has(key)) as NavItemKey[];
      if (items.length === 0) return [];
      if (items.length === 1) return [{ kind: "item", key: items[0]! }];
      return [{ kind: "group", key: entry.group as NavGroupKey, items }];
    });
    return { label, nodes };
  }).filter((section) => section.nodes.length > 0);
}

/** The group that holds an item, for opening it when the page is inside it. */
export function groupOf(key: NavItemKey): NavGroupKey | undefined {
  for (const { entries } of NAV_SECTIONS) {
    for (const entry of entries as readonly Entry[]) {
      if (typeof entry !== "string" && entry.items.includes(key)) return entry.group as NavGroupKey;
    }
  }
  return undefined;
}
