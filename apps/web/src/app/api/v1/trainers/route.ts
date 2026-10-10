import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { createTrainer, listTrainers } from "@/modules/trainers/trainer.service";

export const GET = handleApi(async (request: Request) => {
  const user = await requireApiUser(request);
  const { searchParams } = new URL(request.url);
  return Response.json({ items: await listTrainers(user, { activeOnly: searchParams.get("activeOnly") ?? undefined }) });
});

export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser(request);
  return Response.json(await createTrainer(user, await readJson(request)), { status: 201 });
});
