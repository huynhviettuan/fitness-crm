import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { listCashTransactions, recordCashTransaction } from "@/modules/finance/cash.service";

const FILTERS = ["from", "to", "type", "status", "page", "pageSize"] as const;

export const GET = handleApi(async (request: Request) => {
  const user = await requireApiUser(request);
  const { searchParams } = new URL(request.url);
  const query = Object.fromEntries(FILTERS.map((name) => [name, searchParams.get(name) ?? undefined]));
  return Response.json(await listCashTransactions(user, query));
});

// T-015: requires an Idempotency-Key header; a replay returns 200 with the original.
export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser(request);
  const { transaction, replayed } = await recordCashTransaction(user, await readJson(request), request.headers.get("idempotency-key"));
  return Response.json(transaction, { status: replayed ? 200 : 201 });
});
