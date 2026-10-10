import { handleApi, requireApiUser } from "@/lib/api/route";
import { cancelContract } from "@/modules/contracts/contract.service";

export const POST = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/contracts/[id]/cancel">) => {
  const user = await requireApiUser(request);
  return Response.json(await cancelContract(user, (await ctx.params).id));
});
