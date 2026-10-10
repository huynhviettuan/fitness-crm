import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { voidPayment } from "@/modules/finance/payment.service";

// A-008: the body carries the reason; a repeat returns the voided payment.
export const POST = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/payments/[id]/void">) => {
  const user = await requireApiUser(request);
  return Response.json(await voidPayment(user, (await ctx.params).id, await readJson(request)));
});
