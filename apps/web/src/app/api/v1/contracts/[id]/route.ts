import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { getContract, updateContract } from "@/modules/contracts/contract.service";

type Context = RouteContext<"/api/v1/contracts/[id]">;

export const GET = handleApi(async (request: Request, ctx: Context) => {
  const user = await requireApiUser(request);
  return Response.json(await getContract(user, (await ctx.params).id));
});

// Drafts only; all entered fields are sent (OQ-015 interim).
export const PATCH = handleApi(async (request: Request, ctx: Context) => {
  const user = await requireApiUser(request);
  return Response.json(await updateContract(user, (await ctx.params).id, await readJson(request)));
});
