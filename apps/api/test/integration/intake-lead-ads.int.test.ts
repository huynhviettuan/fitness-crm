import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSource,
  listMessages,
  listSources,
  metaSignature,
  receiveMetaDelivery,
  setPageToken,
} from "../../src/modules/intake/intake.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import type { AppError } from "../../src/platform/errors/app-error.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId } from "../support/factories.js";
import { newLead } from "../support/leads.js";

// Meta Lead Ads (M10.4; brief §11; D-044, D-019, BR-202; A-281 to A-286): the Page's webhook names a lead, its answers are read from
// Meta with the Page token. Meta's Graph API is the external boundary, so it alone is replaced: by a stand-in that answers like Meta
// for the leads a test gives it, and only to a request with the token.

const SECRET = "LeadAdsAppSecret0123456789abcdef";
const TOKEN = `EAAB${"t".repeat(60)}`;

type Field = { name: string; values: string[] };
const meta = {
  leads: new Map<string, Field[]>(),
  requests: [] as { url: string; authorization: string | null }[],
  down: false,
};

beforeEach(() => {
  meta.leads.clear();
  meta.requests = [];
  meta.down = false;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get("authorization");
    meta.requests.push({ url: input, authorization });
    if (meta.down) throw new TypeError("fetch failed");
    const id = new URL(input).pathname.split("/").pop() ?? "";
    if (authorization !== `Bearer ${TOKEN}`) return Response.json({ error: { code: 190 } }, { status: 401 });
    const fields = meta.leads.get(id);
    if (!fields) return Response.json({ error: { code: 100 } }, { status: 400 });
    return Response.json({ id, created_time: "2026-11-08T03:00:00+0000", field_data: fields });
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await resetDatabase();
});

async function world(options: { token?: boolean } = {}) {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  await createTestUser("CONSULTING", { allBranches: true });
  const channelId = await optionId("leadChannels", "WhatsApp");
  const created = await createSource(admin, {
    name: "Trang Demo Gym",
    kind: "MESSENGER",
    channelId,
    appSecret: SECRET,
  });
  if (options.token !== false) await setPageToken(admin, created.source.id, { pageToken: TOKEN });
  return { admin, channelId, source: created.source };
}
type World = Awaited<ReturnType<typeof world>>;

const leadgen = (id: string) => ({
  object: "page",
  entry: [
    { id: "PAGE", time: 1, changes: [{ field: "leadgen", value: { leadgen_id: id, form_id: "77", created_time: 1 } }] },
  ],
});
function deliver(w: World, body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  return receiveMetaDelivery("meta", w.source.id, raw, metaSignature(raw, SECRET), body);
}
const failure = async (promise: Promise<unknown>) =>
  (await promise.then(
    () => null,
    (error: unknown) => error,
  )) as AppError | null;

const answers = (phone = "+84 909 123 456"): Field[] => [
  { name: "full_name", values: ["Nguyễn Văn An"] },
  { name: "phone_number", values: [phone] },
  { name: "email", values: ["An@Example.com"] },
  { name: "Bạn muốn tập gì?", values: ["PT 1-1"] },
];

describe("the Page token (A-283)", () => {
  it("is kept sealed, never returned, audited without its value, and only a Messenger source has one", async () => {
    const w = await world();
    const row = await prisma.intakeSource.findUniqueOrThrow({ where: { id: w.source.id } });
    expect(row.pageTokenEnc).not.toBeNull();
    expect(row.pageTokenEnc).not.toContain(TOKEN);
    const { items } = await listSources(w.admin);
    expect(items[0]).toMatchObject({ hasPageToken: true });
    expect(JSON.stringify(items)).not.toContain(TOKEN);
    const audit = await prisma.auditEvent.findMany({ where: { entityId: w.source.id } });
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
    expect(audit.map((event) => event.action)).toContain("intake_source.page_token_set");

    const instagram = await createSource(w.admin, {
      name: "IG",
      kind: "INSTAGRAM",
      channelId: w.channelId,
      appSecret: SECRET,
    });
    await expect(setPageToken(w.admin, instagram.source.id, { pageToken: TOKEN })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(setPageToken(w.admin, w.source.id, { pageToken: "short" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { allBranches: true });
    await expect(setPageToken(manager, w.source.id, { pageToken: TOKEN })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("a form lead (A-281, A-282)", () => {
  it("is read from Meta with the token in the header, and becomes a lead with the form's answers", async () => {
    const w = await world();
    meta.leads.set("4444555566667777", answers());
    expect(await deliver(w, leadgen("4444555566667777"))).toEqual({ received: 1, duplicates: 0 });

    expect(meta.requests).toHaveLength(1);
    expect(meta.requests[0]!.url).toBe(
      "https://graph.facebook.com/v21.0/4444555566667777?fields=id,created_time,field_data",
    );
    expect(meta.requests[0]!.url).not.toContain(TOKEN);

    const lead = await prisma.customer.findFirstOrThrow({ where: { phone: "0909123456" } });
    expect(lead).toMatchObject({
      fullName: "Nguyễn Văn An",
      email: "an@example.com",
      stage: "LEAD",
      channelId: w.channelId,
    });
    expect(lead.notes).toContain("Bạn muốn tập gì?: PT 1-1");
    expect(lead.picUserId).not.toBeNull();
    const { items } = await listMessages(w.admin, lead.id);
    expect(items).toEqual([expect.objectContaining({ senderName: "Nguyễn Văn An", body: "Bạn muốn tập gì?: PT 1-1" })]);
  });

  it("is an inquiry on the person who already has the phone, not a second person (D-019)", async () => {
    const w = await world();
    const known = await newLead(w.admin, "An cũ", { phone: "0909123456" });
    meta.leads.set("1", answers("0909 123 456"));
    await deliver(w, leadgen("1"));
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.leadInquiry.count({ where: { personId: known.id } })).toBe(1);
  });

  it("is taken in once, however often Meta sends it, and Meta is asked once", async () => {
    const w = await world();
    meta.leads.set("2", answers());
    await deliver(w, leadgen("2"));
    expect(await deliver(w, leadgen("2"))).toEqual({ received: 0, duplicates: 1 });
    expect(meta.requests).toHaveLength(1);
    expect(await prisma.customer.count()).toBe(1);
  });

  it("without a name or phone is still a lead, named after the form, with what was answered", async () => {
    const w = await world();
    meta.leads.set("9876543210", [{ name: "Ghi chú", values: ["<script>x</script>"] }]);
    await deliver(w, leadgen("9876543210"));
    const lead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Lead Ads 543210" } });
    expect(lead.phone).toBeNull();
    expect((await listMessages(w.admin, lead.id)).items[0]?.body).toBe("Ghi chú: <script>x</script>");
  });
});

describe("when the lead cannot be read (A-284)", () => {
  it("fails the delivery and keeps nothing when Meta is down, refuses the token or does not know the lead; the retry works", async () => {
    const w = await world();
    meta.down = true;
    expect((await failure(deliver(w, leadgen("3"))))?.code).toBe("INTERNAL_ERROR");
    meta.down = false;
    // Meta does not know the lead (yet).
    expect((await failure(deliver(w, leadgen("3"))))?.code).toBe("INTERNAL_ERROR");
    expect(await prisma.intakeMessage.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
    meta.leads.set("3", answers());
    expect(await deliver(w, leadgen("3"))).toEqual({ received: 1, duplicates: 0 });
  });

  it("refuses an answer for another lead than the one asked", async () => {
    const w = await world();
    vi.stubGlobal("fetch", async () => Response.json({ id: "999", field_data: [] }));
    expect((await failure(deliver(w, leadgen("4"))))?.code).toBe("INTERNAL_ERROR");
    expect(await prisma.intakeMessage.count()).toBe(0);
  });

  it("skips form leads while the source has no Page token, without asking Meta", async () => {
    const w = await world({ token: false });
    expect(await deliver(w, leadgen("5"))).toEqual({ received: 0, duplicates: 0 });
    expect(meta.requests).toHaveLength(0);
    expect(await prisma.intakeMessage.count()).toBe(0);
  });

  it("never asks Meta about an id that is not a lead id, nor for an Instagram source", async () => {
    const w = await world();
    expect(await deliver(w, leadgen("../me"))).toEqual({ received: 0, duplicates: 0 });
    const instagram = await createSource(w.admin, {
      name: "IG",
      kind: "INSTAGRAM",
      channelId: w.channelId,
      appSecret: SECRET,
    });
    const body = leadgen("6");
    const raw = Buffer.from(JSON.stringify(body));
    expect(await receiveMetaDelivery("meta", instagram.source.id, raw, metaSignature(raw, SECRET), body)).toEqual({
      received: 0,
      duplicates: 0,
    });
    expect(meta.requests).toHaveLength(0);
  });
});
