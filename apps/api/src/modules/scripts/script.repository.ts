import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const scriptSelect = {
  id: true,
  situationVi: true,
  situationEn: true,
  answerVi: true,
  answerEn: true,
  active: true,
  sortOrder: true,
} as const;
export type ScriptRecord = Prisma.ConsultingScriptGetPayload<{ select: typeof scriptSelect }>;

export function listScripts(db: Db, where: Prisma.ConsultingScriptWhereInput): Promise<ScriptRecord[]> {
  return db.consultingScript.findMany({ where, select: scriptSelect, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
}

export function findScript(db: Db, id: string): Promise<ScriptRecord | null> {
  return db.consultingScript.findUnique({ where: { id }, select: scriptSelect });
}

export async function lastSortOrder(db: Db): Promise<number> {
  const last = await db.consultingScript.aggregate({ _max: { sortOrder: true } });
  return last._max.sortOrder ?? 0;
}

export function createScript(db: Db, data: Omit<ScriptRecord, "id">): Promise<ScriptRecord> {
  return db.consultingScript.create({ data, select: scriptSelect });
}

export function updateScript(db: Db, id: string, data: Partial<Omit<ScriptRecord, "id">>): Promise<ScriptRecord> {
  return db.consultingScript.update({ where: { id }, data, select: scriptSelect });
}
