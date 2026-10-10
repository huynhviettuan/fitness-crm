import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { createContract, listContracts } from "@/modules/contracts/contract.service";

type Context = RouteContext<"/api/v1/customers/[id]/contracts">;

export const GET = handleApi(async (request: Request, ctx: Context) => {
  const user = await requireApiUser(request);
  const { searchParams } = new URL(request.url);
  const page = await listContracts(user, {
    customerId: (await ctx.params).id,
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  return Response.json(page);
});

// T-015: requires an Idempotency-Key header; a replay returns 200 with the original.
export const POST = handleApi(async (request: Request, ctx: Context) => {
  const user = await requireApiUser(request);
  const { contract, replayed } = await createContract(
    user,
    (await ctx.params).id,
    await readJson(request),
    request.headers.get("idempotency-key"),
  );
  return Response.json(contract, { status: replayed ? 200 : 201 });
});
