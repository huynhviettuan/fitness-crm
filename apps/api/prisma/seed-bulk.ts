// Volume data for trying lists, paging, filters, and the approval inbox by hand in the local
// development database: leads in every status, customers with contracts, payments (paid,
// part-paid, and unpaid), PT sessions, income and expenses, tasks, deleted records, and
// pending approvals. It goes through the services, like seed-demo.ts, so codes, rules,
// notifications, and audit events are real.
//
// Run after `pnpm db:seed` and `pnpm db:seed:demo` with: pnpm db:seed:bulk
// Local databases only. Runs once; to start over: pnpm --filter api exec prisma migrate reset
import type { Actor } from "../src/platform/auth/session.js";
import type { prisma as client } from "../src/platform/db/prisma.js";
import "dotenv/config";
import { randomUUID } from "node:crypto";

const MARKER_EMAIL = "bulk.marker@example.com";
const COUNTS = { leads: 70, customers: 48, tasks: 36, cash: 40 };

const LAST = [
  "Nguyễn",
  "Trần",
  "Lê",
  "Phạm",
  "Hoàng",
  "Huỳnh",
  "Phan",
  "Vũ",
  "Võ",
  "Đặng",
  "Bùi",
  "Đỗ",
  "Hồ",
  "Ngô",
  "Dương",
];
const MIDDLE = ["Văn", "Thị", "Minh", "Ngọc", "Thanh", "Quốc", "Hữu", "Thu", "Gia", "Anh", "Kim", "Đức"];
const FIRST = [
  "An",
  "Bình",
  "Chi",
  "Dũng",
  "Giang",
  "Hà",
  "Hải",
  "Hiếu",
  "Khoa",
  "Linh",
  "Long",
  "Mai",
  "Nam",
  "Phúc",
  "Quân",
  "Sơn",
  "Trang",
  "Tú",
  "Vy",
  "Yến",
];
const name = (i: number) =>
  `${LAST[i % LAST.length]} ${MIDDLE[(i * 7) % MIDDLE.length]} ${FIRST[(i * 3 + Math.floor(i / 20)) % FIRST.length]}`;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Bulk data is for a local database only (DATABASE_URL is not localhost).");
  }
  if ([process.env.TEST_DATABASE_URL, process.env.E2E_DATABASE_URL].includes(url)) {
    throw new Error("DATABASE_URL points at the test or E2E database; use the development database.");
  }
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
  const { createCustomer } = await import("../src/modules/customers/customer.service.js");
  const { createContract } = await import("../src/modules/contracts/contract.service.js");
  const { activateContract } = await import("../src/modules/contracts/contract-approval.service.js");
  const { createService, saveTiers } = await import("../src/modules/services/service.service.js");
  const { createEmployee: addEmployee } = await import("../src/modules/employees/employee.service.js");
  const { cancelBooking, createBooking, markNoShow } = await import("../src/modules/bookings/booking.service.js");
  const { checkIn, completeSession } = await import("../src/modules/sessions/session.service.js");
  const { recordPayment, deletePayment } = await import("../src/modules/finance/payment.service.js");
  const { recordCashTransaction, deleteCashTransaction } = await import("../src/modules/finance/cash.service.js");
  const { createLead } = await import("../src/modules/leads/lead.service.js");
  const { assignLead, changeLeadStatus } = await import("../src/modules/leads/lead-journey.service.js");
  const { noShowLead, showLead } = await import("../src/modules/leads/lead-outcome.service.js");
  const { addComment, createTask, moveTask } = await import("../src/modules/tasks/task.service.js");
  const { approveRequest } = await import("../src/modules/approvals/approval.service.js");
  const { loadCurrentUser } = await import("../src/platform/auth/actor.js");

  const actorByEmail = async (email: string): Promise<Actor> => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`Run \`pnpm db:seed:demo\` first (no user ${email}).`);
    return (await loadCurrentUser(prisma, user.id))!;
  };
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const admin = await actorByEmail(adminEmail);
  const manager = await actorByEmail("demo-manager@fitness-crm.test");
  const reception = await actorByEmail("demo-receptionist@fitness-crm.test");
  const trainerStaff = await actorByEmail("demo-trainer@fitness-crm.test");
  const accountant = await actorByEmail("demo-accountant@fitness-crm.test");
  // Added to the demo after some databases were seeded, so create it when it is missing.
  const consultingEmail = "demo-consulting@fitness-crm.test";
  if (!(await prisma.user.findUnique({ where: { email: consultingEmail } }))) {
    const { createUser } = await import("../src/modules/users/user.service.js");
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "CONSULTING" }, select: { id: true } });
    const branchId = (await prisma.branch.findFirstOrThrow({ orderBy: { createdAt: "asc" }, select: { id: true } })).id;
    await createUser(admin, {
      name: "Bùi Ngọc Lan",
      email: consultingEmail,
      roleId: role.id,
      branchIds: [branchId],
      password: process.env.SEED_ADMIN_PASSWORD!,
    });
  }
  const consulting = await actorByEmail(consultingEmail);
  const team = [admin, manager, reception, trainerStaff, accountant, consulting];

  if (await prisma.customer.findFirst({ where: { email: MARKER_EMAIL } })) {
    console.log(
      "Bulk data is already loaded; nothing to do. To start over: pnpm --filter api exec prisma migrate reset",
    );
    return;
  }

  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  const day = (offset: number) => {
    const date = new Date(today.getTime() + offset * 86_400_000);
    return `${[date.getUTCDate(), date.getUTCMonth() + 1].map((n) => String(n).padStart(2, "0")).join("/")}/${date.getUTCFullYear()}`;
  };
  const branch = await prisma.branch.findFirstOrThrow({ orderBy: { createdAt: "asc" }, select: { id: true } });

  let failed = 0;
  const attempt = async <T>(label: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      if (++failed <= 8) console.warn(`  skipped ${label}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  const optionIds = async (listKey: string) =>
    (
      await prisma.option.findMany({ where: { listKey, isOther: false, active: true }, orderBy: { sortOrder: "asc" } })
    ).map((o) => o.id);
  const addOption = async (listKey: string, labelVi: string, labelEn = labelVi) => {
    const found = await prisma.option.findFirst({ where: { listKey, labelVi }, select: { id: true } });
    if (found) return found.id;
    const last = await prisma.option.aggregate({ where: { listKey, isOther: false }, _max: { sortOrder: true } });
    return (
      await prisma.option.create({ data: { listKey, labelVi, labelEn, sortOrder: (last._max.sortOrder ?? 0) + 1 } })
    ).id;
  };

  const startedAt = new Date();

  // --- Customers with contracts, payments, and sessions
  console.log("Customers, contracts, payments, sessions…");
  const trainers = await prisma.employee.findMany({
    where: { isTrainer: true, status: "ACTIVE" },
    orderBy: { fullName: "asc" },
    select: { id: true },
  });
  const methods = await optionIds("paymentMethods");
  const wrongAmount = await addOption("deleteReasons", "Ghi nhầm số tiền", "Wrong amount");
  const enteredTwice = await addOption("deleteReasons", "Nhập trùng", "Entered twice");
  // Contracts are priced from services (M4.3): each runs 181 days from its start.
  const PACKAGES = [
    { service: "PT", price: 500_000, sessions: 12 },
    { service: "PT", price: 500_000, sessions: 24 },
    { service: "PT", price: 500_000, sessions: 36 },
    { service: "Yoga", price: 300_000, sessions: 12 },
    { service: "Gym", price: 375_000, sessions: 12 },
  ].map((spec) => ({ ...spec, value: spec.price * spec.sessions }));
  const serviceIds = new Map<string, string>();
  for (const spec of PACKAGES) {
    if (serviceIds.has(spec.service)) continue;
    const service = await createService(admin, {
      name: spec.service,
      kind: "MEMBER",
      branchIds: [(await prisma.branch.findFirstOrThrow({ select: { id: true } })).id],
    });
    await saveTiers(admin, service.id, {
      effectiveFrom: "01/01/2020",
      tiers: [{ minSessions: 1, maxSessions: 1000, unitPrice: spec.price, validityMonths: 0, validityDays: 181 }],
    });
    serviceIds.set(spec.service, service.id);
  }
  const seller = await addEmployee(manager, { fullName: "Nguyễn Thị Bán Hàng" });
  const vnd = (amount: number) => amount.toLocaleString("de-DE");
  const end = (hour: number) => `${String(hour + 1).padStart(2, "0")}:00`;
  const hh = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  const payments: { id: string }[] = [];

  for (let i = 0; i < COUNTS.customers; i++) {
    const customer = await attempt(`customer ${i}`, () =>
      createCustomer(reception, {
        fullName: name(i + 100),
        phone: `0882${String(100000 + i)}`,
        email: i === 0 ? MARKER_EMAIL : `bulk.customer${i}@example.com`,
      }),
    );
    if (!customer) continue;
    const spec = PACKAGES[i % PACKAGES.length];
    const start = -(20 + (i % 9) * 8);
    const created = await attempt(`contract ${i}`, async () => {
      const { contract } = await createContract(
        manager,
        customer.id,
        {
          serviceId: serviceIds.get(spec.service),
          sessions: spec.sessions,
          contractDate: day(start),
          startDate: day(start),
          saleShares: [{ employeeId: seller.id, percent: 100 }],
        },
        randomUUID(),
      );
      // Every 11th stays a draft, so the list shows more than one status.
      return i % 11 === 10 ? contract : activateContract(admin, contract.id);
    });
    if (!created || i % 11 === 10) continue;

    // Paid in full, half, or not at all: the debt list gets rows too.
    const share = [1, 0.5, 0, 1, 0.4, 1, 0.75][i % 7];
    if (share > 0) {
      const method = methods[i % methods.length];
      const paid = await attempt(`payment ${i}`, () =>
        recordPayment(
          reception,
          created.id,
          {
            amount: vnd(Math.round((spec.value * share) / 1000) * 1000),
            methodId: method,
            methodNote: "",
            paidOn: day(start + 1),
          },
          randomUUID(),
        ),
      );
      if (paid) payments.push(paid.payment);
    }

    // Sessions: two done, one no-show or cancelled on some, two coming up. One trainer and
    // hour per customer; a clash with the demo schedule is skipped, not fatal.
    if (trainers.length === 0) continue;
    const trainerId = trainers[i % trainers.length].id;
    const hour = 5 + (Math.floor(i / trainers.length) % 16);
    const book = (offset: number) =>
      createBooking(reception, {
        customerId: customer.id,
        contractId: created.id,
        trainerId,
        date: day(offset),
        startTime: hh(hour),
        endTime: end(hour),
      });
    for (const offset of [-6, -3]) {
      await attempt(`done session ${i}`, async () => {
        const booking = await book(offset);
        await checkIn(reception, booking.id);
        await completeSession(manager, booking.id);
        await prisma.session.update({
          where: { bookingId: booking.id },
          data: {
            checkedInAt: new Date(booking.scheduledStart.getTime() - 5 * 60_000),
            completedAt: booking.scheduledEnd,
          },
        });
      });
    }
    if (i % 5 === 0) await attempt(`no-show ${i}`, async () => markNoShow(reception, (await book(-9)).id));
    if (i % 7 === 0) await attempt(`cancel ${i}`, async () => cancelBooking(reception, (await book(-12)).id));
    for (const offset of [1, 4]) await attempt(`booking ${i}`, () => book(offset));
  }

  // --- Income and expenses over three months
  console.log("Income and expenses…");
  const incomeCategories = await optionIds("incomeCategories");
  const expenseTypes = await optionIds("expenseTypes");
  const cashRows: { id: string }[] = [];
  for (let i = 0; i < COUNTS.cash; i++) {
    const income = i % 3 === 0;
    const list = income ? incomeCategories : expenseTypes;
    const row = await attempt(`cash ${i}`, () =>
      recordCashTransaction(
        accountant,
        {
          type: income ? "INCOME" : "EXPENSE",
          categoryId: list[i % list.length],
          amount: vnd((income ? 200_000 : 500_000) + (i % 9) * 150_000),
          occurredOn: day(-((i * 2) % 85)),
          reference: i % 4 === 0 ? `REF-${1000 + i}` : "",
        },
        randomUUID(),
      ),
    );
    if (row) cashRows.push(row.transaction);
  }

  // --- Leads in every status (the board, the list, and the re-care queue)
  console.log("Leads…");
  const channels = await optionIds("leadChannels");
  const sources = await optionIds("leadSources");
  const needs = await optionIds("needGroups");
  const refuseReasons = [
    await addOption("leadRefuseReasons", "Giá cao", "Too expensive"),
    await addOption("leadRefuseReasons", "Xa nhà", "Too far"),
    await addOption("leadRefuseReasons", "Đã tập nơi khác", "Training elsewhere"),
  ];
  const receivers = [consulting];
  let shown = 0;
  for (let i = 0; i < COUNTS.leads; i++) {
    const lead = await attempt(`lead ${i}`, () =>
      createLead(admin, {
        branchId: branch.id,
        fullName: name(i),
        // Every 9th has no phone yet (a channel may not give one).
        phone: i % 9 === 8 ? "" : `0881${String(100000 + i)}`,
        email: i % 4 === 0 ? `bulk.lead${i}@example.com` : "",
        channelId: channels[i % channels.length],
        sourceId: sources[i % sources.length],
        needGroupId: needs[i % needs.length],
        needDetail: i % 3 === 0 ? "Giảm cân, tập 3 buổi mỗi tuần" : "",
      }),
    );
    if (!lead) continue;
    // Spread them over a month, as if they came in over time.
    const createdAt = new Date(Date.now() - ((i * 11) % 30) * 86_400_000 - (i % 5) * 3_600_000);
    await prisma.customer.update({ where: { id: lead.id }, data: { createdAt } });

    // Some stay New (unassigned); the rest are handed to someone who receives leads.
    if (i % 8 === 7) continue;
    await attempt(`assign ${i}`, () => assignLead(admin, lead.id, { userId: receivers[i % receivers.length].id }));

    const step = i % 10;
    const move = (status: string, extra: Record<string, string> = {}) =>
      attempt(`${status} ${i}`, () => changeLeadStatus(admin, lead.id, { status, ...extra }));
    if (step <= 1) continue; // Consulting
    if (step === 2) await move("CONSIDERING");
    else if (step === 3) await move("NO_RESPONSE");
    else if (step === 4)
      await move("REFUSED", {
        refuseReasonId: refuseReasons[i % refuseReasons.length],
        note: "Khách chưa sắp xếp được thời gian",
      });
    else if (step === 6 && i % 20 === 6) {
      // Booked, then did not come: waits in the re-care queue (BR-204).
      await move("BOOKED", { appointmentDate: day(1), appointmentTime: "09:00" });
      await attempt(`no-show lead ${i}`, () => noShowLead(admin, lead.id));
    } else if (step === 5 || step === 6)
      await move("BOOKED", {
        appointmentDate: day(1 + (i % 6)),
        appointmentTime: `${String(8 + (i % 10)).padStart(2, "0")}:30`,
      });
    else if (step === 7) {
      await move("BOOKED", { appointmentDate: day(1 + (i % 4)), appointmentTime: "10:00" });
      await attempt(`show ${i}`, async () => {
        await showLead(admin, lead.id, {
          idDocumentType: "CCCD",
          idDocumentNumber: `079${String(300000000 + i)}`,
          birthDate: `${String(1 + (i % 27)).padStart(2, "0")}/0${1 + (i % 9)}/${1980 + (i % 25)}`,
          countryCode: "VN",
          nationalityGroup: "VIETNAM",
          email: `bulk.shown${i}@example.com`,
          phone: `0881${String(100000 + i)}`,
          healthNote: i % 2 === 0 ? "Đau lưng nhẹ" : "",
          consent: true,
        });
        shown++;
      });
    }
    // step 8, 9: stay Consulting with a checklist in progress.
  }

  // --- Tasks in every status, some overdue, with comments
  console.log("Tasks…");
  const TITLES = [
    "Gọi lại khách chưa phản hồi",
    "Kiểm tra máy chạy bộ số 3",
    "Chuẩn bị báo cáo doanh thu tháng",
    "Cập nhật bảng giá gói PT",
    "Xác nhận lịch PT tuần sau",
    "Đặt mua khăn tập",
    "Liên hệ khách sắp hết hợp đồng",
    "Dọn kho dụng cụ",
    "Chụp ảnh quảng cáo phòng tập",
    "Đối chiếu sổ quỹ cuối tuần",
  ];
  const priorities = ["LOW", "NORMAL", "HIGH"] as const;
  for (let i = 0; i < COUNTS.tasks; i++) {
    const assigner = team[i % team.length];
    const assignee = team[(i + 1 + (i % 3)) % team.length];
    if (assignee.id === assigner.id) continue;
    const task = await attempt(`task ${i}`, () =>
      createTask(assigner, {
        branchId: branch.id,
        title: `${TITLES[i % TITLES.length]} #${i + 1}`,
        description: i % 2 === 0 ? "Xem chi tiết trong ghi chú của buổi họp đầu tuần." : "",
        assigneeUserId: assignee.id,
        dueDate: day(-4 + ((i * 3) % 14)),
        dueTime: i % 2 === 0 ? "17:00" : "09:30",
        priority: priorities[i % 3],
      }),
    );
    if (!task) continue;
    const state = i % 6; // 0,1 New · 2 Accepted · 3 In progress · 4 Done · 5 Cancelled
    if (state >= 2) await attempt(`accept ${i}`, () => moveTask(assignee, task.id, "accept"));
    if (state === 3) await attempt(`start ${i}`, () => moveTask(assignee, task.id, "start"));
    if (state === 4) await attempt(`complete ${i}`, () => moveTask(assignee, task.id, "complete"));
    if (state === 5) await attempt(`cancel ${i}`, () => moveTask(assigner, task.id, "cancel"));
    if (i % 4 === 0)
      await attempt(`comment ${i}`, () =>
        addComment(assignee, task.id, { body: "Đã nhận, mình sẽ làm trong hôm nay." }),
      );
  }

  // --- Deleted records: some approved (trash and audit), the rest left waiting in the inbox
  console.log("Deletions and approvals…");
  // Payments and cash rows count only once approved (D-018), so approve them before deleting any.
  const waitingCreates = await prisma.approvalRequest.findMany({
    where: { status: "PENDING", submittedAt: { gte: startedAt }, actionType: { endsWith: ".create" } },
    orderBy: { submittedAt: "asc" },
  });
  for (const request of waitingCreates) await attempt(`approve ${request.id}`, () => approveRequest(admin, request.id));
  for (const [n, payment] of payments.slice(0, 18).entries()) {
    await attempt(`delete payment ${n}`, () =>
      deletePayment(accountant, payment.id, { reasonId: n % 2 ? wrongAmount : enteredTwice, reasonNote: "" }),
    );
  }
  for (const [n, row] of cashRows.slice(0, 10).entries()) {
    await attempt(`delete cash ${n}`, () =>
      deleteCashTransaction(accountant, row.id, { reasonId: n % 2 ? wrongAmount : enteredTwice, reasonNote: "" }),
    );
  }
  const pending = await prisma.approvalRequest.findMany({
    where: { status: "PENDING", submittedAt: { gte: startedAt } },
    orderBy: { submittedAt: "asc" },
  });
  // Approve the first third of the deletions (they go to the trash); the rest stay in the inbox.
  for (const request of pending.slice(0, Math.floor(pending.length / 3))) {
    await attempt(`approve ${request.id}`, () => approveRequest(admin, request.id));
  }

  const counts = await Promise.all([
    prisma.customer.count({ where: { stage: "LEAD" } }),
    prisma.customer.count({ where: { stage: "CUSTOMER" } }),
    prisma.contract.count(),
    prisma.booking.count(),
    prisma.payment.count(),
    prisma.cashTransaction.count(),
    prisma.task.count(),
    prisma.approvalRequest.count({ where: { status: "PENDING" } }),
    prisma.trashEntry.count(),
    prisma.auditEvent.count(),
    prisma.notification.count(),
  ]);
  console.log(
    [
      "Bulk data loaded (totals in the database):",
      `  ${counts[0]} leads, ${counts[1]} customers (${shown} shown from leads), ${counts[2]} contracts`,
      `  ${counts[3]} bookings, ${counts[4]} payments, ${counts[5]} income/expense rows, ${counts[6]} tasks`,
      `  ${counts[7]} pending approvals, ${counts[8]} trash entries, ${counts[9]} audit events, ${counts[10]} notifications`,
      failed > 0 ? `  ${failed} steps were skipped (rules or clashes with existing data).` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
