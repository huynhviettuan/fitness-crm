import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { getCustomer, updateCustomer } from "@/modules/customers/customer.service";

export const GET = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/customers/[id]">) => {
  const user = await requireApiUser(request);
  const { id } = await ctx.params;
  return Response.json(await getCustomer(user, id));
});

export const PATCH = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/customers/[id]">) => {
  const user = await requireApiUser(request);
  const { id } = await ctx.params;
  return Response.json(await updateCustomer(user, id, await readJson(request)));
});
