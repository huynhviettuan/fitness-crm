import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { updateTrainer } from "@/modules/trainers/trainer.service";

// All fields are sent: name, status, and the linked login (A-010).
export const PATCH = handleApi(async (request: Request, ctx: RouteContext<"/api/v1/trainers/[id]">) => {
  const user = await requireApiUser(request);
  return Response.json(await updateTrainer(user, (await ctx.params).id, await readJson(request)));
});
