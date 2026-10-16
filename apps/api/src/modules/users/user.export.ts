import type { User } from "@gymcrm/shared/users";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { statusLabel } from "../../platform/export/labels.js";
import { listUsers } from "./user.service.js";

/** The user list has no filters: its export takes none. */
export const USER_EXPORT_QUERY = [] as const;

/** The users to Excel (FR-PLT-001). The list has no pages, so the export pages through it. */
export const usersExport: ExportDefinition<User> = {
  list: "users",
  title: { vi: "Người dùng", en: "Users" },
  permission: "user.export",
  columns: [
    { header: { vi: "Họ và tên", en: "Name" }, value: (u) => u.name, width: 28 },
    { header: { vi: "Email", en: "Email" }, value: (u) => u.email, width: 32 },
    { header: { vi: "Vai trò", en: "Role" }, value: (u) => u.role.name, width: 22 },
    { header: { vi: "Trạng thái", en: "Status" }, value: (u, l) => statusLabel("user", u.status, l) },
    {
      header: { vi: "Chi nhánh", en: "Branches" },
      value: (u, l) => (u.allBranches ? (l === "vi" ? "Tất cả" : "All") : u.branches.map((b) => b.name).join(", ")),
      width: 28,
    },
    { header: { vi: "Ngày tạo", en: "Created" }, kind: "datetime", value: (u) => u.createdAt },
  ],
  fetch: async (actor, _filters, page, pageSize) => {
    const all = await listUsers(actor);
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
  },
};
