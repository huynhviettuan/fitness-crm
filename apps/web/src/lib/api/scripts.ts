import "server-only";
import { scriptListSchema, scriptSchema, type ScriptInput } from "@flow/shared/leads";
import { api, query, read } from "./client";

// The consulting script library (FR-LEAD-010, A-072).

/** Active scripts with an answer; `includeInactive` lists every script and needs `script.manage`. */
export async function listScripts(includeInactive = false) {
  const { items } = await read(
    scriptListSchema,
    (await api()).GET("/api/v1/consulting-scripts", {
      params: { query: query({ includeInactive: includeInactive || undefined }) },
    }),
  );
  return items;
}

export async function createScript(input: ScriptInput) {
  return read(scriptSchema, (await api()).POST("/api/v1/consulting-scripts", { body: input as never }));
}

export async function updateScript(id: string, input: ScriptInput) {
  return read(
    scriptSchema,
    (await api()).PATCH("/api/v1/consulting-scripts/{id}", { params: { path: { id } }, body: input as never }),
  );
}

export async function reorderScripts(scriptIds: string[]) {
  const { items } = await read(
    scriptListSchema,
    (await api()).PUT("/api/v1/consulting-scripts/order", { body: { scriptIds } }),
  );
  return items;
}
