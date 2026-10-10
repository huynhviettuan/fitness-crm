import { handleApi, requireApiUser } from "@/lib/api/route";
import { checkIn } from "@/modules/sessions/session.service";

export const POST = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/bookings/[id]/check-in">) => {
  const user = await requireApiUser(request);
  return Response.json(await checkIn(user, (await ctx.params).id));
});
