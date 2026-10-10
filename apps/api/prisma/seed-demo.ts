// Demo data for trying the app by hand in the local development database: staff for
// every role, trainers, customers, contracts in every state, a month of bookings, and
// payments and income/expenses. It goes through the services, so codes, business rules,
// and audit events are real. Dates are relative to today in the gym timezone.
//
// Run after `pnpm db:seed` with: pnpm db:seed:demo
// Local databases only. Runs once; to start over: pnpm --filter api exec prisma migrate reset
import "dotenv/config";
import { randomUUID } from "node:crypto";

const DEMO_MANAGER_EMAIL = "demo-manager@fitness-crm.test";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Demo data is for a local database only (DATABASE_URL is not localhost).");
  }
  if ([process.env.TEST_DATABASE_URL, process.env.E2E_DATABASE_URL].includes(url)) {
    throw new Error("DATABASE_URL points at the test or E2E database; use the development database.");
  }

  // Imported after dotenv so the app's environment check sees .env.
  const { prisma } = await import("../src/platform/db/prisma.js");
  try {
    await seed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function seed(prisma: typeof import("../src/platform/db/prisma.js").prisma) {
  const { env } = await import("../src/platform/env.js");
  const { calendarDateInTimeZone } = await import("@flow/shared/validation");
  const { createUser } = await import("../src/modules/users/user.service.js");
  const { createTrainer, updateTrainer } = await import("../src/modules/trainers/trainer.service.js");
  const { createCustomer, updateCustomer } = await import("../src/modules/customers/customer.service.js");
  const { activateContract, cancelContract, createContract } = await import("../src/modules/contracts/contract.service.js");
  const { cancelBooking, createBooking, markNoShow } = await import("../src/modules/bookings/booking.service.js");
  const { checkIn, completeSession } = await import("../src/modules/sessions/session.service.js");
  const { recordPayment, voidPayment } = await import("../src/modules/finance/payment.service.js");
  const { recordCashTransaction, voidCashTransaction } = await import("../src/modules/finance/cash.service.js");
  const { loadCurrentUser } = await import("../src/platform/auth/actor.js");
  type Actor = import("../src/platform/auth/session.js").Actor;
  const actorOf = async (userId: string): Promise<Actor> => (await loadCurrentUser(prisma, userId))!;

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const admin = adminEmail ? await prisma.user.findUnique({ where: { email: adminEmail } }) : null;
  if (!admin || !password) throw new Error("Run `pnpm db:seed` first (SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env).");
  if (await prisma.user.findUnique({ where: { email: DEMO_MANAGER_EMAIL } })) {
    console.log("Demo data is already loaded; nothing to do. To start over: pnpm --filter api exec prisma migrate reset");
    return;
  }

  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  /** A day relative to today, as dd/MM/yyyy. */
  // A gym day as staff type it: dd/MM/yyyy.
  const day = (offset: number) => {
    const date = new Date(today.getTime() + offset * 86_400_000);
    return [date.getUTCDate(), date.getUTCMonth() + 1].map((n) => String(n).padStart(2, "0")).join("/") + `/${date.getUTCFullYear()}`;
  };
  const asAdmin = await actorOf(admin.id);
  // Everything goes to the default branch the migration created (D-014).
  const branch = await prisma.branch.findFirstOrThrow({ orderBy: { createdAt: "asc" }, select: { id: true } });

  // --- Staff: one account per default role (09_RBAC.md), signing in with the seed admin's password.
  const staff = {} as Record<"FITNESS_MANAGER" | "RECEPTIONIST" | "PT" | "ACCOUNTANT" | "CONSULTING", Actor>;
  for (const [code, name, email] of [
    ["FITNESS_MANAGER", "Phạm Quốc Bảo", DEMO_MANAGER_EMAIL],
    ["RECEPTIONIST", "Võ Thị Hồng", "demo-receptionist@fitness-crm.test"],
    ["PT", "Trần Minh Khoa", "demo-trainer@fitness-crm.test"],
    ["ACCOUNTANT", "Đặng Thu Trang", "demo-accountant@fitness-crm.test"],
    ["CONSULTING", "Bùi Ngọc Lan", "demo-consulting@fitness-crm.test"],
  ] as const) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code }, select: { id: true } });
    const user = await createUser(asAdmin, { name, email, roleId: role.id, branchIds: [branch.id], password });
    staff[code] = await actorOf(user.id);
  }
  const { FITNESS_MANAGER: manager, RECEPTIONIST: reception, ACCOUNTANT: accountant } = staff;

  // --- Trainers: Khoa signs in as the demo trainer; Nam has left.
  const khoa = await createTrainer(manager, { fullName: "Trần Minh Khoa", userId: staff.PT.id });
  const ha = await createTrainer(manager, { fullName: "Lê Thu Hà" });
  const anh = await createTrainer(manager, { fullName: "Phạm Đức Anh" });
  const nam = await createTrainer(manager, { fullName: "Nguyễn Hoàng Nam" });
  await updateTrainer(manager, nam.id, { fullName: nam.fullName, status: "INACTIVE" });

  // --- Customers
  const people: [string, string, string?][] = [
    ["Nguyễn Văn An", "0909123456", "an.nguyen@example.com"],
    ["Hoàng Thị Mai", "0912345678"],
    ["Đỗ Quang Huy", "0987654321"],
    ["Vũ Ngọc Lan", "0933221100", "lan.vu@example.com"],
    ["Trần Thị Thu Hương", "0905556677"],
    ["Lê Minh Tuấn", "0938889900"],
    ["Bùi Thanh Tâm", "0977112233"],
    ["Ngô Gia Bảo", "0966554433"],
    ["Phan Thị Kim Ngân", "0944332211"],
    ["Đinh Công Sơn", "0922113344"],
    ["Lý Thị Hoa", "0911002200"],
  ];
  const customers = [];
  for (const [fullName, phone, email] of people) customers.push(await createCustomer(reception, { fullName, phone, email: email ?? "" }));
  const [an, mai, huy, lan, huong, tuan, tam, bao, ngan, son, hoa] = customers;
  await updateCustomer(reception, hoa.id, { status: "INACTIVE", notes: "Chuyển nhà, tạm ngưng tập." });

  type ContractSpec = { pkg: string; value: string; sessions: number; start: number; end: number };
  const PT24 = { pkg: "PT 24 buổi", value: "12.000.000", sessions: 24 };
  const PT12 = { pkg: "PT 12 buổi", value: "6.500.000", sessions: 12 };
  async function contract(customerId: string, spec: ContractSpec, activate = true) {
    const { contract: created } = await createContract(
      manager,
      customerId,
      { packageName: spec.pkg, contractValue: spec.value, totalSessions: String(spec.sessions), startDate: day(spec.start), endDate: day(spec.end) },
      randomUUID(),
    );
    return activate ? activateContract(manager, created.id) : created;
  }

  // --- Bookings. Each contract trains with one trainer at one hour, so nothing overlaps.
  type Plan = { contractId: string; customerId: string; trainerId: string; hour: string };
  const end = (hour: string) => `${String(Number(hour.slice(0, 2)) + 1).padStart(2, "0")}:${hour.slice(3)}`;
  const book = (plan: Plan, offset: number) =>
    createBooking(reception, {
      customerId: plan.customerId,
      contractId: plan.contractId,
      trainerId: plan.trainerId,
      date: day(offset),
      startTime: plan.hour,
      endTime: end(plan.hour),
    });
  async function completed(plan: Plan, offset: number) {
    const booking = await book(plan, offset);
    await checkIn(reception, booking.id);
    await completeSession(manager, booking.id);
    // Show the session as it happened, not as the moment this script ran.
    await prisma.session.update({
      where: { bookingId: booking.id },
      data: { checkedInAt: new Date(booking.scheduledStart.getTime() - 5 * 60_000), completedAt: booking.scheduledEnd },
    });
  }
  /** `count` past sessions every `every` days back from yesterday; listed ones become no-show or cancelled. */
  async function history(plan: Plan, count: number, every: number, exceptions: Record<number, "noShow" | "cancel"> = {}) {
    for (let i = count; i >= 1; i--) {
      const offset = -i * every;
      if (exceptions[i] === "noShow") await markNoShow(reception, (await book(plan, offset)).id);
      else if (exceptions[i] === "cancel") await cancelBooking(reception, (await book(plan, offset)).id);
      else await completed(plan, offset);
    }
  }
  const plan = (c: { id: string }, customer: { id: string }, trainer: { id: string }, hour: string): Plan => ({
    contractId: c.id,
    customerId: customer.id,
    trainerId: trainer.id,
    hour,
  });

  // An: well under way; trained today; second contract (yoga) too (BR-002).
  const c1 = await contract(an.id, { ...PT24, start: -45, end: 135 });
  const p1 = plan(c1, an, khoa, "07:00");
  await history(p1, 12, 3, { 5: "noShow" });
  await completed(p1, 0);
  for (const offset of [2, 4]) await book(p1, offset);
  const yoga = await contract(an.id, { pkg: "Yoga 12 buổi", value: "3.600.000", sessions: 12, start: -5, end: 85 });

  // Mai: checked in right now.
  const c2 = await contract(mai.id, { ...PT24, start: -30, end: 150 });
  const p2 = plan(c2, mai, ha, "08:00");
  await history(p2, 8, 3);
  await checkIn(reception, (await book(p2, 0)).id);
  await book(p2, 3);

  // Huy: 2 sessions left, so "ending soon" (D-012, A-023).
  const c3 = await contract(huy.id, { ...PT12, start: -40, end: 50 });
  const p3 = plan(c3, huy, anh, "18:00");
  await history(p3, 10, 3);
  await book(p3, 0);
  await book(p3, 2);

  // Lan: booked this evening and through the week.
  const c4 = await contract(lan.id, { ...PT24, start: -20, end: 160 });
  const p4 = plan(c4, lan, khoa, "17:00");
  await history(p4, 5, 4);
  for (const offset of [0, 1, 3, 5]) await book(p4, offset);

  // Hương: didn't come this morning.
  const c5 = await contract(huong.id, { ...PT12, start: -10, end: 80 });
  const p5 = plan(c5, huong, ha, "06:00");
  await history(p5, 3, 3);
  await markNoShow(reception, (await book(p5, 0)).id);
  await book(p5, 2);

  // Tuấn: cancelled tonight, has paid nothing yet.
  const c6 = await contract(tuan.id, { ...PT24, start: -15, end: 165 });
  const p6 = plan(c6, tuan, anh, "19:00");
  await history(p6, 4, 3, { 2: "cancel" });
  await cancelBooking(reception, (await book(p6, 0)).id);
  await book(p6, 1);

  // Tâm: a draft, not activated yet.
  await contract(tam.id, { ...PT24, start: 3, end: 183 }, false);

  // Bảo: expired 10 days ago with sessions unused. Its sessions were booked while it
  // ran; the end date is then moved into the past to stand for the time that went by.
  const c8 = await contract(bao.id, { ...PT24, start: -200, end: 10 });
  await history(plan(c8, bao, khoa, "09:00"), 18, 10);
  await prisma.contract.update({ where: { id: c8.id }, data: { endDate: new Date(today.getTime() - 10 * 86_400_000) } });

  // Ngân: cancelled; her upcoming session was cancelled with it (D-010).
  const c9 = await contract(ngan.id, { ...PT24, start: -5, end: 175 });
  await book(plan(c9, ngan, ha, "10:00"), 2);

  // Sơn: imported at go-live with opening balances (D-011), as the import tool will do.
  const { contract: c10Draft } = await createContract(
    manager,
    son.id,
    { packageName: PT24.pkg, contractValue: PT24.value, totalSessions: "24", startDate: day(-150), endDate: day(30) },
    randomUUID(),
  );
  await prisma.contract.update({ where: { id: c10Draft.id }, data: { openingSessionsUsed: 16, openingPaidAmount: 9_000_000 } });
  const c10 = await activateContract(manager, c10Draft.id);
  await history(plan(c10, son, anh, "07:00"), 3, 7);

  // --- Payments
  const pay = (c: { id: string }, amount: string, method: "CASH" | "BANK_TRANSFER" | "CARD" | "E_WALLET", offset: number) =>
    recordPayment(reception, c.id, { amount, method, paidOn: day(offset) }, randomUUID());
  await pay(c1, "6.000.000", "BANK_TRANSFER", -45);
  await pay(c1, "6.000.000", "CASH", -15);
  await pay(yoga, "3.600.000", "CARD", -5);
  await pay(c2, "5.000.000", "CARD", -30);
  await pay(c3, "6.500.000", "BANK_TRANSFER", -40);
  await pay(c4, "4.000.000", "CASH", -20);
  await pay(c4, "2.000.000", "E_WALLET", -2);
  await pay(c5, "3.000.000", "CASH", -10);
  const wrong = await pay(c5, "3.250.000", "CASH", -9);
  await voidPayment(accountant, wrong.payment.id, { reason: "Ghi nhầm số tiền, khách chỉ trả 3.000.000" });
  await pay(c8, "10.000.000", "BANK_TRANSFER", -199);
  await pay(c9, "2.000.000", "CASH", -5);
  await pay(c10, "1.000.000", "CASH", -7);
  await cancelContract(manager, c9.id);

  // --- Income and expenses (this month and last)
  const cash = (type: "INCOME" | "EXPENSE", category: string, amount: string, offset: number, reference = "") =>
    recordCashTransaction(accountant, { type, category, amount, occurredOn: day(offset), reference }, randomUUID());
  await cash("INCOME", "Bán nước uống", "450.000", -1);
  await cash("INCOME", "Phí gửi xe", "300.000", -3);
  await cash("EXPENSE", "Tiền điện", "3.200.000", -5, "EVN-0921");
  const duplicate = await cash("EXPENSE", "Tiền điện", "3.200.000", -5, "EVN-0921");
  await voidCashTransaction(accountant, duplicate.transaction.id, { reason: "Nhập trùng" });
  await cash("EXPENSE", "Tiền nước", "650.000", -5);
  await cash("EXPENSE", "Mua khăn tập", "800.000", -8);
  await cash("INCOME", "Bán nước uống", "520.000", -33);
  await cash("EXPENSE", "Sửa máy chạy bộ", "1.500.000", -35);

  const counts = await Promise.all([prisma.customer.count(), prisma.contract.count(), prisma.booking.count(), prisma.payment.count()]);
  console.log(`Demo data loaded: ${counts[0]} customers, ${counts[1]} contracts, ${counts[2]} bookings, ${counts[3]} payments.`);
  console.log("Sign in as any of these with the same password as SEED_ADMIN_PASSWORD in .env:");
  for (const email of [
    DEMO_MANAGER_EMAIL,
    "demo-receptionist@fitness-crm.test",
    "demo-trainer@fitness-crm.test",
    "demo-accountant@fitness-crm.test",
    "demo-consulting@fitness-crm.test",
  ]) {
    console.log(`  ${email}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
