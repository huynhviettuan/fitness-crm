import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { createBooking, listBookings } from "@/modules/bookings/booking.service";

const FILTERS = ["from", "to", "status", "trainerId", "customerId", "contractId", "order", "page", "pageSize"] as const;

export const GET = handleApi(async (request: Request) => {
  const user = await requireApiUser(request);
  const { searchParams } = new URL(request.url);
  const query = Object.fromEntries(FILTERS.map((name) => [name, searchParams.get(name) ?? undefined]));
  return Response.json(await listBookings(user, query));
});

// No Idempotency-Key (T-015 covers money and contracts): a repeated create for the
// same trainer and time is refused by the overlap constraint (T-014).
export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser(request);
  return Response.json(await createBooking(user, await readJson(request)), { status: 201 });
});
