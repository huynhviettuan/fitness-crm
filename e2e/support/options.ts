import type { APIRequestContext } from "@playwright/test";

/** Option list keys (D-016); the same as `OPTION_LISTS` in packages/shared. */
export type OptionListKey =
  | "paymentMethods"
  | "incomeCategories"
  | "expenseTypes"
  | "deleteReasons"
  | "leadRefuseReasons"
  | "auditFailReasons"
  | "needDetails"
  | "stepReopenReasons"
  | "leadChannels";

type Option = { id: string; labelVi: string; active: boolean; isOther: boolean };

/** The label the migration gives each list's "Other" option (seed data, not UI text). */
export const OTHER_OPTION_LABEL = "Khác";

async function activeOptions(api: APIRequestContext, listKey: OptionListKey): Promise<Option[]> {
  const response = await api.get(`/api/v1/option-lists/${listKey}/options`);
  if (!response.ok()) throw new Error(`Options of ${listKey}: ${response.status()}`);
  return ((await response.json()) as { items: Option[] }).items;
}

/** The list's "Khác" option, which needs a note wherever it is chosen. */
export async function otherOptionId(api: APIRequestContext, listKey: OptionListKey): Promise<string> {
  const other = (await activeOptions(api, listKey)).find((option) => option.isOther);
  if (!other) throw new Error(`No Khác in ${listKey}`);
  return other.id;
}

/**
 * An option for this test, made through the admin API. Its label carries the test tag,
 * so teardown removes it with the records that use it.
 */
export async function createOptionViaApi(
  admin: APIRequestContext,
  listKey: OptionListKey,
  labelVi: string,
  code?: string,
): Promise<string> {
  const response = await admin.post(`/api/v1/option-lists/${listKey}/options`, {
    data: { labelVi, labelEn: labelVi, ...(code ? { code } : {}) },
  });
  if (response.status() !== 201) throw new Error(`Option setup failed: ${response.status()} ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}
