import { handleApi, requireApiUser } from "@/lib/api/route";
import { completeSession } from "@/modules/sessions/session.service";

// Idempotent: repeating it returns the same completed state and consumes nothing more
// (BR-007). The response carries the contract with its new remaining sessions.
export const POST = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/bookings/[id]/complete">) => {
  const user = await requireApiUser(request);
  return Response.json(await completeSession(user, (await ctx.params).id));
});
