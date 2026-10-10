import vi from "../../messages/vi.json" with { type: "json" };

/** UI text comes from the Vietnamese catalog, never hard-coded in specs (docs/13). */
export const labels = vi;

/** Fills simple ICU placeholders, e.g. fill(labels.users.created, { name }). */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
