import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { listPayments, recordPayment } from "@/modules/finance/payment.service";

type Context = RouteContext<"/api/v1/contracts/[id]/payments">;

export const GET = handleApi(async (request: Request, ctx: Context) => {
  const user = await requireApiUser(request);
  const { searchParams } = new URL(request.url);
  const page = await listPayments(user, {
    contractId: (await ctx.params).id,
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  return Response.json(page);
});

// T-015: requires an Idempotency-Key header; a replay returns 200 with the original.
export const POST = handleApi(async (request: Request, ctx: Context) => {
  const user = await requireApiUser(request);
  const { payment, replayed } = await recordPayment(
    user,
    (await ctx.params).id,
    await readJson(request),
    request.headers.get("idempotency-key"),
  );
  return Response.json(payment, { status: replayed ? 200 : 201 });
});
