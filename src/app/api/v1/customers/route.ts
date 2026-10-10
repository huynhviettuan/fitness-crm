import { handleApi, readJson, requireApiUser } from "@/lib/api/route";
import { createCustomer, listCustomers } from "@/modules/customers/customer.service";

export const GET = handleApi(async (request: Request) => {
  const user = await requireApiUser(request);
  const { searchParams } = new URL(request.url);
  const page = await listCustomers(user, {
    q: searchParams.get("search") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  return Response.json(page);
});

export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser(request);
  const customer = await createCustomer(user, await readJson(request));
  return Response.json(customer, { status: 201 });
});
