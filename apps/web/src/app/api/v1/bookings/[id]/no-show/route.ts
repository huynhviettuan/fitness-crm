import { handleApi, requireApiUser } from "@/lib/api/route";
import { markNoShow } from "@/modules/bookings/booking.service";

export const POST = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/bookings/[id]/no-show">) => {
  const user = await requireApiUser(request);
  return Response.json(await markNoShow(user, (await ctx.params).id));
});
