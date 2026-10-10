import { handleApi, requireApiUser } from "@/lib/api/route";
import { cancelBooking } from "@/modules/bookings/booking.service";

export const POST = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/bookings/[id]/cancel">) => {
  const user = await requireApiUser(request);
  return Response.json(await cancelBooking(user, (await ctx.params).id));
});
