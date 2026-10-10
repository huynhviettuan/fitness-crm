import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { getBooking, rescheduleBooking } from "@/modules/bookings/booking.service";

type Context = RouteContext<"/api/v1/bookings/[id]">;

export const GET = handleApi(async (request: Request, ctx: Context) => {
  const user = await requireApiUser(request);
  return Response.json(await getBooking(user, (await ctx.params).id));
});

// Reschedule (A-006: BOOKED only): trainer, date, start and end time.
export const PATCH = handleApi(async (request: Request, ctx: Context) => {
  const user = await requireApiUser(request);
  return Response.json(await rescheduleBooking(user, (await ctx.params).id, await readJson(request)));
});
