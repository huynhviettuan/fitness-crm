import { handleApi, requireApiUser } from "@/lib/api/route";
import { activateContract } from "@/modules/contracts/contract.service";

export const POST = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/contracts/[id]/activate">) => {
  const user = await requireApiUser(request);
  return Response.json(await activateContract(user, (await ctx.params).id));
});
