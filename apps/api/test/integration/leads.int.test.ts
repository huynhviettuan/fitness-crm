import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { createLead, getLead, listLeads, updateLead } from "../../src/modules/leads/lead.service.js";
import { createCustomer, getCustomer, listCustomers } from "../../src/modules/customers/customer.service.js";
import { createContract } from "../../src/modules/contracts/contract.service.js";
import { createRole } from "../../src/platform/roles/role.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestBranch, createTestUser, inRoundRobinOrder, optionId, uniquePhone } from "../support/factories.js";
import { contractInput } from "../support/bookings.js";

afterEach(async () => {
  await resetDatabase();
});

const WHATSAPP = await optionId("leadChannels", "WhatsApp");
const FANPAGE = await optionId("leadSources", "Fanpage");
const PAIN_RELIEF = await optionId("needGroups", "2 - Pain Relief & Better Movement");
const OTHER_CHANNEL = await optionId("leadChannels", "Khác");

describe("adding a lead (brief §4.1, FR-LEAD-001)", () => {
  it("creates a NEW lead with an LD code, its channel and source, nobody in charge, and an audit event", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    const lead = await createLead(reception, {
      fullName: "Trần Thị Mai",
      phone: "0912 345 678",
      channelId: WHATSAPP,
      sourceId: FANPAGE,
      sourceType: "PAID",
      needGroupId: PAIN_RELIEF,
      needDetail: "Đau lưng khi ngồi lâu",
      countryCode: "VN",
    });

    expect(lead).toMatchObject({
      leadCode: expect.stringMatching(/^LD\d{6}$/),
      customerCode: null,
      stage: "LEAD",
      status: "NEW",
      phone: "0912345678",
      channel: { id: WHATSAPP, labelVi: "WhatsApp" },
      source: { id: FANPAGE },
      sourceType: "PAID",
      needGroup: { id: PAIN_RELIEF },
      pic: null,
      createdBy: { id: reception.id },
    });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: lead.id } });
    expect(audit).toMatchObject({ entityType: "lead", action: "lead.created", actorUserId: reception.id });
  });

  it("takes each choice from its own list, and Khác only with a note (D-016)", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    await expect(createLead(manager, { fullName: "A", channelId: OTHER_CHANNEL })).rejects.toMatchObject({
      fieldErrors: { channelNote: ["otherNeedsNote"] },
    });
    await expect(createLead(manager, { fullName: "A", channelId: FANPAGE })).rejects.toMatchObject({
      fieldErrors: { channelId: ["invalidChoice"] },
    });
    await expect(createLead(manager, { fullName: "A", channelId: WHATSAPP, sourceId: WHATSAPP })).rejects.toMatchObject(
      {
        fieldErrors: { sourceId: ["invalidChoice"] },
      },
    );
    await expect(
      createLead(manager, { fullName: "A", channelId: OTHER_CHANNEL, channelNote: "Hội chợ" }),
    ).resolves.toMatchObject({
      channel: { isOther: true, note: "Hội chợ" },
    });
  });

  it.each(["PT", "MASTER", "MARKETING", "ACCOUNTANT"] as const)("refuses a %s (09_RBAC.md)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(createLead(actor, { fullName: "A", channelId: WHATSAPP })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("one person, one record (D-019)", () => {
  it("refuses a phone that is already a customer's or a lead's, and names the record", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const customer = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    const lead = await createLead(reception, { fullName: "Lê Hoa", phone: "0933111222", channelId: WHATSAPP });

    await expect(
      createLead(reception, { fullName: "An", phone: "0909.123.456", channelId: WHATSAPP }),
    ).rejects.toMatchObject({
      code: "DUPLICATE_PHONE",
      duplicate: { id: customer.id, stage: "CUSTOMER", code: customer.customerCode, fullName: "Nguyễn Văn An" },
    });
    await expect(createCustomer(reception, { fullName: "Hoa", phone: "0933111222" })).rejects.toMatchObject({
      code: "PHONE_ALREADY_USED",
      duplicate: { id: lead.id, stage: "LEAD", code: lead.leadCode },
    });
    const other = await createLead(reception, { fullName: "Khác", phone: uniquePhone(), channelId: WHATSAPP });
    await expect(
      updateLead(reception, other.id, { fullName: "Khác", phone: "0933111222", channelId: WHATSAPP }),
    ).rejects.toMatchObject({
      code: "PHONE_ALREADY_USED",
    });
  });

  it("does not name a record the user may not see", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const branch = await createTestBranch();
    await createLead(admin, { fullName: "Lead Q7", phone: "0944555666", channelId: WHATSAPP, branchId: branch.id });
    const { actor: consulting } = await createTestUser("CONSULTING");

    const refused = await createLead(consulting, { fullName: "A", phone: "0944555666", channelId: WHATSAPP }).catch(
      (error: unknown) => error,
    );

    expect(refused).toMatchObject({ code: "DUPLICATE_PHONE", duplicate: undefined });
  });

  it("tells a consultant who has the lead of their own branch that their scope does not open (D-060)", async () => {
    const { actor: first } = await createTestUser("CONSULTING");
    const { actor: second } = await createTestUser("CONSULTING");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const phone = uniquePhone();
    const lead = await createLead(reception, { fullName: "Của người khác", phone, channelId: WHATSAPP });
    const owner = lead.pic!.id === first.id ? first : second;
    const other = owner === first ? second : first;

    const refused = await createLead(other, { fullName: "A", phone, channelId: WHATSAPP }).catch((e: unknown) => e);

    expect(refused).toMatchObject({
      code: "DUPLICATE_PHONE",
      duplicate: { id: lead.id, stage: "LEAD", code: lead.leadCode, openable: false, inCharge: lead.pic!.name },
    });
    // The owner and a manager may open it, as before.
    await expect(createLead(owner, { fullName: "A", phone, channelId: WHATSAPP })).rejects.toMatchObject({
      duplicate: { id: lead.id, openable: true },
    });
  });

  it("needs only a name and a channel, and checks for a duplicate only when a phone is given (D-060)", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    const one = await createLead(reception, { fullName: "Không số 1", channelId: WHATSAPP });
    const two = await createLead(reception, { fullName: "Không số 2", channelId: WHATSAPP });

    expect(one).toMatchObject({ phone: null, stage: "LEAD" });
    expect(two.id).not.toBe(one.id);
  });

  it("lets only one of two leads with the same phone in, when they arrive together", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const phone = uniquePhone();

    const results = await Promise.allSettled([
      createLead(reception, { fullName: "A", phone, channelId: WHATSAPP }),
      createLead(reception, { fullName: "B", phone, channelId: WHATSAPP }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "DUPLICATE_PHONE" } });
  });

  it("keeps leads off the customer screens, and a lead cannot get a contract before Show", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const lead = await createLead(manager, { fullName: "Lê Hoa", phone: uniquePhone(), channelId: WHATSAPP });
    const customer = await createCustomer(manager, { fullName: "Nguyễn Văn An", phone: uniquePhone() });

    expect((await listCustomers(manager, {})).items.map((c) => c.id)).toEqual([customer.id]);
    await expect(getCustomer(manager, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLead(manager, customer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createContract(manager, lead.id, await contractInput(), randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("the nationality is a country (D-057)", () => {
  it("keeps the country, derives the group from it, and says no to an unknown country", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    const home = await createLead(reception, { fullName: "A", channelId: WHATSAPP, countryCode: "vn" });
    const abroad = await createLead(reception, { fullName: "B", channelId: WHATSAPP, countryCode: "KR" });
    const none = await createLead(reception, { fullName: "C", channelId: WHATSAPP });

    expect(home).toMatchObject({ countryCode: "VN", nationalityGroup: "VIETNAM" });
    expect(abroad).toMatchObject({ countryCode: "KR", nationalityGroup: "FOREIGN" });
    expect(none).toMatchObject({ countryCode: null, nationalityGroup: null });
    await expect(
      createLead(reception, { fullName: "D", channelId: WHATSAPP, countryCode: "ZZ" }),
    ).rejects.toMatchObject({ fieldErrors: { countryCode: ["invalidChoice"] } });
  });

  it("keeps the group of a person who has only that, until a country is chosen", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const lead = await createLead(manager, { fullName: "Cũ", channelId: WHATSAPP });
    // An imported person: only "Nước ngoài", no country, which needs completing.
    await prisma.customer.update({ where: { id: lead.id }, data: { nationalityGroup: "FOREIGN" } });

    const edited = await updateLead(manager, lead.id, { fullName: "Cũ", channelId: WHATSAPP, countryCode: "" });
    expect(edited).toMatchObject({ countryCode: null, nationalityGroup: "FOREIGN" });

    const completed = await updateLead(manager, lead.id, { fullName: "Cũ", channelId: WHATSAPP, countryCode: "JP" });
    expect(completed).toMatchObject({ countryCode: "JP", nationalityGroup: "FOREIGN" });
    const home = await updateLead(manager, lead.id, { fullName: "Cũ", channelId: WHATSAPP, countryCode: "VN" });
    expect(home).toMatchObject({ countryCode: "VN", nationalityGroup: "VIETNAM" });
  });
});

describe("seeing and editing leads", () => {
  it("searches by name without diacritics, code, and phone, and filters by channel and need", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const mai = await createLead(manager, {
      fullName: "Trần Thị Mai",
      phone: "0912345678",
      channelId: WHATSAPP,
      needGroupId: PAIN_RELIEF,
    });
    const hoa = await createLead(manager, { fullName: "Lê Hoa", channelId: OTHER_CHANNEL, channelNote: "Hội chợ" });

    const ids = async (query: Record<string, string>) => (await listLeads(manager, query)).items.map((lead) => lead.id);
    expect(await ids({ q: "tran thi mai" })).toEqual([mai.id]);
    expect(await ids({ q: hoa.leadCode.toLowerCase() })).toEqual([hoa.id]);
    expect(await ids({ q: "0912 345" })).toEqual([mai.id]);
    expect(await ids({ channelId: WHATSAPP, needGroupId: PAIN_RELIEF, status: "NEW" })).toEqual([mai.id]);
    expect(await ids({})).toEqual([hoa.id, mai.id]);
  });

  it("shows a consultant only the leads they added or are in charge of (T-061)", async () => {
    const { actor: first } = await createTestUser("CONSULTING");
    const { actor: second } = await createTestUser("CONSULTING");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    await inRoundRobinOrder(second.id, first.id);
    // Round-robin: the first lead goes to `second`, the next to `first`.
    const own = await createLead(first, { fullName: "Của tôi", channelId: WHATSAPP });
    const theirs = await createLead(reception, { fullName: "Lễ tân nhập", channelId: WHATSAPP });
    const third = await createLead(reception, { fullName: "Lead thứ ba", channelId: WHATSAPP });

    expect([own.pic?.id, theirs.pic?.id, third.pic?.id]).toEqual([second.id, first.id, second.id]);
    expect((await listLeads(first, {})).items.map((lead) => lead.id).sort()).toEqual([own.id, theirs.id].sort());
    expect((await listLeads(second, {})).items.map((lead) => lead.id).sort()).toEqual([own.id, third.id].sort());
    await expect(getLead(first, third.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listLeads(reception, {})).total).toBe(3);
  });

  it("audits an edit with the values before and after", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const lead = await createLead(reception, { fullName: "Lê Hoa", channelId: WHATSAPP });

    const edited = await updateLead(reception, lead.id, {
      fullName: "Lê Thị Hoa",
      channelId: WHATSAPP,
      needGroupId: PAIN_RELIEF,
      gender: "FEMALE",
    });

    expect(edited).toMatchObject({ fullName: "Lê Thị Hoa", gender: "FEMALE", needGroup: { id: PAIN_RELIEF } });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: lead.id, action: "lead.updated" } });
    expect(audit).toMatchObject({
      before: { fullName: "Lê Hoa", needGroupId: null },
      after: { fullName: "Lê Thị Hoa", needGroupId: PAIN_RELIEF },
    });
  });

  it("hides the phone and email of a role that has them masked, and keeps them on edit (D-017)", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const role = await createRole(admin, {
      name: "Tư vấn ẩn SĐT",
      permissions: ["lead.view", "lead.create", "lead.manage"],
      dataScopes: {
        leads: "ALL",
        customers: "ALL",
        contracts: "ALL",
        schedule: "ALL",
        vouchers: "ALL",
        staff: "ALL",
        tasks: "OWN",
      },
      fieldMasks: ["customer.phone", "customer.email"],
    });
    const { actor } = await createTestUser("CONSULTING", { roleId: role.id });
    const lead = await createLead(admin, {
      fullName: "Lê Hoa",
      phone: "0977888999",
      email: "hoa@mail.vn",
      channelId: WHATSAPP,
    });

    expect(await getLead(actor, lead.id)).toMatchObject({ phone: null, email: null, maskedFields: ["phone", "email"] });
    expect((await listLeads(actor, { q: "0977888" })).total).toBe(0);
    await updateLead(actor, lead.id, { fullName: "Lê Thị Hoa", phone: "", email: "", channelId: WHATSAPP });
    expect(await getLead(admin, lead.id)).toMatchObject({ phone: "0977888999", email: "hoa@mail.vn" });
  });
});
