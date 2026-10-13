// Demo data for trying the app by hand in the local development database: staff for
// every role, trainers, customers, contracts in every state, a month of bookings, and
// payments and income/expenses. It goes through the services, so codes, business rules,
// and audit events are real. Dates are relative to today in the gym timezone.
//
// Run after `pnpm db:seed` with: pnpm db:seed:demo
// Local databases only. Runs once; to start over: pnpm --filter api exec prisma migrate reset
import type { Actor } from "../src/platform/auth/session.js";
import type { prisma as client } from "../src/platform/db/prisma.js";
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

async function seed(prisma: typeof client) {
  const { env } = await import("../src/platform/env.js");
  const { calendarDateInTimeZone } = await import("@flow/shared/validation");
  const { createUser } = await import("../src/modules/users/user.service.js");
  const { createEmployee, replaceShifts, updateEmployee } =
    await import("../src/modules/employees/employee.service.js");
  const { createCustomer, updateCustomer } = await import("../src/modules/customers/customer.service.js");
  const { cancelContract, createContract } = await import("../src/modules/contracts/contract.service.js");
  const { activateContract } = await import("../src/modules/contracts/contract-approval.service.js");
  const { createService, saveTiers } = await import("../src/modules/services/service.service.js");
  const { cancelBooking, createBooking, markNoShow } = await import("../src/modules/bookings/booking.service.js");
  const { checkIn, completeSession } = await import("../src/modules/sessions/session.service.js");
  const { recordPayment, deletePayment } = await import("../src/modules/finance/payment.service.js");
  const { recordCashTransaction, deleteCashTransaction } = await import("../src/modules/finance/cash.service.js");
  const { loadCurrentUser } = await import("../src/platform/auth/actor.js");
  const { approveRequest } = await import("../src/modules/approvals/approval.service.js");
  const actorOf = async (userId: string): Promise<Actor> => (await loadCurrentUser(prisma, userId))!;

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const admin = adminEmail ? await prisma.user.findUnique({ where: { email: adminEmail } }) : null;
  if (!admin || !password)
    throw new Error("Run `pnpm db:seed` first (SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env).");
  if (await prisma.user.findUnique({ where: { email: DEMO_MANAGER_EMAIL } })) {
    console.log(
      "Demo data is already loaded; nothing to do. To start over: pnpm --filter api exec prisma migrate reset",
    );
    return;
  }

  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  /** A day relative to today, as dd/MM/yyyy. */
  // A gym day as staff type it: dd/MM/yyyy.
  const day = (offset: number) => {
    const date = new Date(today.getTime() + offset * 86_400_000);
    return `${[date.getUTCDate(), date.getUTCMonth() + 1].map((n) => String(n).padStart(2, "0")).join("/")}/${date.getUTCFullYear()}`;
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

  // --- Employees (brief §8.4): each staff account has one; Khoa signs in as the demo
  // trainer, Hà and Anh teach without signing in yet, and Nam has left.
  for (const code of ["FITNESS_MANAGER", "RECEPTIONIST", "ACCOUNTANT", "CONSULTING"] as const) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: staff[code].id }, select: { name: true } });
    await createEmployee(manager, { fullName: user.name, userId: staff[code].id });
  }
  const trainer = async (fullName: string, userId = "") => {
    const created = await createEmployee(manager, { fullName, userId, isTrainer: true });
    // Every day 05:00–22:00, like the calendar; admin narrows it on the schedule screen.
    await replaceShifts(manager, created.id, {
      shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "05:00", end: "22:00" })),
    });
    return created;
  };
  const khoa = await trainer("Trần Minh Khoa", staff.PT.id);
  const ha = await trainer("Lê Thu Hà");
  const anh = await trainer("Phạm Đức Anh");
  const nam = await trainer("Nguyễn Hoàng Nam");
  await updateEmployee(manager, nam.id, { fullName: nam.fullName, isTrainer: true, status: "INACTIVE" });

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
  for (const [fullName, phone, email] of people)
    customers.push(await createCustomer(reception, { fullName, phone, email: email ?? "" }));
  const [an, mai, huy, lan, huong, tuan, tam, bao, ngan, son, hoa] = customers;
  await updateCustomer(reception, hoa.id, { status: "INACTIVE", notes: "Chuyển nhà, tạm ngưng tập." });

  // Contracts are priced from services (M4.3): PT at 500,000 and Yoga at 300,000 a session, each for 181 days. The
  // end day of a spec is only a note of when it runs out; the tier decides it.
  type ContractSpec = { service: "PT" | "Yoga"; sessions: number; start: number; end: number };
  const PT24 = { service: "PT" as const, sessions: 24 };
  const PT12 = { service: "PT" as const, sessions: 12 };
  const demoServices = new Map<string, string>();
  for (const [name, price] of [
    ["PT", 500_000],
    ["Yoga", 300_000],
  ] as const) {
    const service = await createService(asAdmin, {
      name,
      kind: "MEMBER",
      branchIds: [(await prisma.branch.findFirstOrThrow({ select: { id: true } })).id],
    });
    await saveTiers(asAdmin, service.id, {
      effectiveFrom: "01/01/2020",
      tiers: [{ minSessions: 1, maxSessions: 1000, unitPrice: price, validityMonths: 0, validityDays: 181 }],
    });
    demoServices.set(name, service.id);
  }
  const seller = await createEmployee(manager, { fullName: "Nguyễn Thị Bán Hàng" });
  async function contract(customerId: string, spec: ContractSpec, activate = true) {
    const { contract: created } = await createContract(
      manager,
      customerId,
      {
        serviceId: demoServices.get(spec.service),
        sessions: spec.sessions,
        contractDate: day(spec.start),
        startDate: day(spec.start),
        saleShares: [{ employeeId: seller.id, percent: 100 }],
      },
      randomUUID(),
    );
    return activate ? activateContract(asAdmin, created.id) : created;
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
  async function history(
    plan: Plan,
    count: number,
    every: number,
    exceptions: Record<number, "noShow" | "cancel"> = {},
  ) {
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
  const yoga = await contract(an.id, { service: "Yoga", sessions: 12, start: -5, end: 85 });

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
  await prisma.contract.update({
    where: { id: c8.id },
    data: { endDate: new Date(today.getTime() + 10 * 86_400_000) },
  });
  await history(plan(c8, bao, khoa, "09:00"), 18, 10);
  await prisma.contract.update({
    where: { id: c8.id },
    data: { endDate: new Date(today.getTime() - 10 * 86_400_000) },
  });

  // Ngân: cancelled; her upcoming session was cancelled with it (D-010).
  const c9 = await contract(ngan.id, { ...PT24, start: -5, end: 175 });
  await book(plan(c9, ngan, ha, "10:00"), 2);

  // Sơn: imported at go-live with opening balances (D-011), as the import tool will do.
  const { contract: c10Draft } = await createContract(
    manager,
    son.id,
    {
      serviceId: demoServices.get("PT"),
      sessions: 24,
      contractDate: day(-150),
      startDate: day(-150),
      saleShares: [{ employeeId: seller.id, percent: 100 }],
    },
    randomUUID(),
  );
  await prisma.contract.update({
    where: { id: c10Draft.id },
    data: {
      openingSessionsUsed: 16,
      openingPaidAmount: 9_000_000,
      endDate: new Date(today.getTime() + 30 * 86_400_000),
    },
  });
  const c10 = await activateContract(asAdmin, c10Draft.id);
  await history(plan(c10, son, anh, "07:00"), 3, 7);

  // --- Option lists (D-016): the migration's payment methods, plus example categories
  // and reasons an admin would add on screen.
  const option = async (listKey: string, labelVi: string, labelEn = labelVi) => {
    const found = await prisma.option.findFirst({ where: { listKey, labelVi }, select: { id: true } });
    if (found) return found.id;
    const last = await prisma.option.aggregate({ where: { listKey, isOther: false }, _max: { sortOrder: true } });
    const created = await prisma.option.create({
      data: { listKey, labelVi, labelEn, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
    return created.id;
  };
  const method = {
    CASH: await option("paymentMethods", "Tiền mặt"),
    BANK_TRANSFER: await option("paymentMethods", "Chuyển khoản"),
    CARD: await option("paymentMethods", "Thẻ"),
    OTHER: await option("paymentMethods", "Khác"),
  };
  const wrongAmount = await option("deleteReasons", "Ghi nhầm số tiền", "Wrong amount");
  const enteredTwice = await option("deleteReasons", "Nhập trùng", "Entered twice");

  // Everything submitted under the approval matrix so far is approved (D-018): by the
  // admin, or by the Fitness Manager for customer identity changes.
  const approvePending = async () => {
    for (const request of await prisma.approvalRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { submittedAt: "asc" },
    })) {
      await approveRequest(request.actionType === "customer.identity" ? manager : asAdmin, request.id);
    }
  };

  // --- Payments
  const pay = (c: { id: string }, amount: string, how: keyof typeof method, offset: number, note = "") =>
    recordPayment(
      reception,
      c.id,
      { amount, methodId: method[how], methodNote: note, paidOn: day(offset) },
      randomUUID(),
    );
  await pay(c1, "6.000.000", "BANK_TRANSFER", -45);
  await pay(c1, "6.000.000", "CASH", -15);
  await pay(yoga, "3.600.000", "CARD", -5);
  await pay(c2, "5.000.000", "CARD", -30);
  await pay(c3, "6.500.000", "BANK_TRANSFER", -40);
  await pay(c4, "4.000.000", "CASH", -20);
  await pay(c4, "2.000.000", "OTHER", -2, "Ví MoMo");
  await pay(c5, "3.000.000", "CASH", -10);
  const wrong = await pay(c5, "3.250.000", "CASH", -9);
  await approvePending();
  await deletePayment(accountant, wrong.payment.id, { reasonId: wrongAmount, reasonNote: "Khách chỉ trả 3.000.000" });
  await pay(c8, "10.000.000", "BANK_TRANSFER", -199);
  await pay(c9, "2.000.000", "CASH", -5);
  await pay(c10, "1.000.000", "CASH", -7);
  await cancelContract(manager, c9.id);

  // --- Income and expenses (this month and last)
  const cash = async (type: "INCOME" | "EXPENSE", category: string, amount: string, offset: number, reference = "") =>
    recordCashTransaction(
      accountant,
      {
        type,
        categoryId: await option(type === "INCOME" ? "incomeCategories" : "expenseTypes", category),
        methodId: await option("paymentMethods", "Tiền mặt"),
        payee: type === "EXPENSE" ? "Nhà cung cấp" : "",
        amount,
        occurredOn: day(offset),
        reference,
      },
      randomUUID(),
    );
  await cash("INCOME", "Bán nước uống", "450.000", -1);
  await cash("INCOME", "Phí gửi xe", "300.000", -3);
  await cash("EXPENSE", "Tiền điện", "3.200.000", -5, "EVN-0921");
  const duplicate = await cash("EXPENSE", "Tiền điện", "3.200.000", -5, "EVN-0921");
  await approvePending();
  await deleteCashTransaction(accountant, duplicate.transaction.id, { reasonId: enteredTwice });
  await cash("EXPENSE", "Tiền nước", "650.000", -5);
  await cash("EXPENSE", "Mua khăn tập", "800.000", -8);
  await cash("INCOME", "Bán nước uống", "520.000", -33);
  await cash("EXPENSE", "Sửa máy chạy bộ", "1.500.000", -35);

  await approvePending();

  const counts = await Promise.all([
    prisma.customer.count(),
    prisma.contract.count(),
    prisma.booking.count(),
    prisma.payment.count(),
  ]);
  console.log(
    `Demo data loaded: ${counts[0]} customers, ${counts[1]} contracts, ${counts[2]} bookings, ${counts[3]} payments.`,
  );
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
