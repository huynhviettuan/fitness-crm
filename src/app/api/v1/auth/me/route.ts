import { handleApi, requireApiUser } from "@/lib/api/route";
import { trainerIdOfUser } from "@/modules/trainers/trainer.service";

export const GET = handleApi(async (request: Request) => {
  const user = await requireApiUser(request);
  return Response.json({ ...user, trainerId: await trainerIdOfUser(user.id) });
});
