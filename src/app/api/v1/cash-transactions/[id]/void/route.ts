import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { voidCashTransaction } from "@/modules/finance/cash.service";

// A-009: the body carries the reason; a repeat returns the voided transaction.
export const POST = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/cash-transactions/[id]/void">) => {
  const user = await requireApiUser(request);
  return Response.json(await voidCashTransaction(user, (await ctx.params).id, await readJson(request)));
});
