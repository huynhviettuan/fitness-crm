import { countryName } from "@gymcrm/shared/countries";
import type { AnalysisBucket, AnalysisDimension, ConsultingReportRow } from "@gymcrm/shared/leads";
import type { ExportDefinition } from "../../platform/export/export.service.js";
import { optionText } from "../../platform/export/labels.js";
import { consultingReport, leadAnalysis } from "./report.service.js";

/** The query keys of the report exports: the cohort's filters (A-089). */
export const REPORT_QUERY = ["from", "to", "branchId", "staffId"] as const;

const DIMENSION_LABEL: Record<AnalysisDimension, { vi: string; en: string }> = {
  channel: { vi: "Kênh liên hệ", en: "Contact channel" },
  source: { vi: "Nguồn lead", en: "Lead source" },
  sourceType: { vi: "Organic / Paid", en: "Organic / Paid" },
  needGroup: { vi: "Nhóm nhu cầu", en: "Need group" },
  nationalityGroup: { vi: "Nhóm quốc tịch", en: "Nationality group" },
  country: { vi: "Quốc gia", en: "Country" },
  refuseReason: { vi: "Lý do từ chối", en: "Refusal reason" },
};

const VALUE_LABEL: Record<string, { vi: string; en: string }> = {
  ORGANIC: { vi: "Organic", en: "Organic" },
  PAID: { vi: "Paid", en: "Paid" },
  VIETNAM: { vi: "Việt Nam", en: "Vietnam" },
  FOREIGN: { vi: "Nước ngoài", en: "Foreign" },
};

const NOT_GIVEN = { vi: "Chưa có", en: "Not given" };

type ConsultingRow = { team: boolean; row: ConsultingReportRow };

/** The consulting dashboard to Excel (brief §9): a row per consultant and the team last. */
export const consultingReportExport: ExportDefinition<ConsultingRow> = {
  list: "consulting-dashboard",
  title: { vi: "Dashboard tư vấn", en: "Consulting dashboard" },
  permission: "report.consultingExport",
  columns: [
    {
      header: { vi: "Người tư vấn", en: "Consultant" },
      value: ({ team, row }, l) =>
        team
          ? l === "vi"
            ? "Toàn đội"
            : "Whole team"
          : (row.consultant?.name ?? (l === "vi" ? "Chưa có người phụ trách" : "Nobody in charge")),
      width: 28,
    },
    { header: { vi: "Lead nhận", en: "Leads" }, kind: "number", value: ({ row }) => row.leads },
    { header: { vi: "Đã tư vấn", en: "Consulted" }, kind: "number", value: ({ row }) => row.consulted },
    { header: { vi: "Đã đặt lịch", en: "Booked" }, kind: "number", value: ({ row }) => row.booked },
    { header: { vi: "Show", en: "Show" }, kind: "number", value: ({ row }) => row.showed },
    { header: { vi: "Ký hợp đồng", en: "Contracted" }, kind: "number", value: ({ row }) => row.contracted },
    {
      header: { vi: "Tỷ lệ đặt lịch (%)", en: "Booking rate (%)" },
      kind: "number",
      value: ({ row }) => row.bookingRate,
    },
    { header: { vi: "Tỷ lệ show (%)", en: "Show rate (%)" }, kind: "number", value: ({ row }) => row.showRate },
    { header: { vi: "Đúng hạn (%)", en: "On time (%)" }, kind: "number", value: ({ row }) => row.compliance },
    { header: { vi: "Điểm audit (%)", en: "Audit score (%)" }, kind: "number", value: ({ row }) => row.score },
    {
      header: { vi: "Phản hồi đầu tiên (phút)", en: "First response (minutes)" },
      kind: "number",
      value: ({ row }) => row.firstResponseMinutes,
    },
    {
      header: { vi: "Vào tái chăm sóc", en: "Entered re-care" },
      kind: "number",
      value: ({ row }) => row.recareEntered,
    },
    { header: { vi: "Đặt lịch lại", en: "Booked again" }, kind: "number", value: ({ row }) => row.recareRebooked },
    {
      header: { vi: "Tỷ lệ đặt lịch lại (%)", en: "Booked again rate (%)" },
      kind: "number",
      value: ({ row }) => row.recareRate,
    },
    {
      header: { vi: "Bị chuyển lượt", en: "Moved on" },
      kind: "number",
      value: ({ row }) => row.reclaimed,
    },
  ],
  fetch: async (actor, query, page, pageSize) => {
    const report = await consultingReport(actor, query);
    const all: ConsultingRow[] = [
      ...report.items.map((row) => ({ team: false, row })),
      { team: true, row: { consultant: null, ...report.team } },
    ];
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
  },
};

type AnalysisRow = { dimension: AnalysisDimension; bucket: AnalysisBucket };

function bucketLabel(bucket: AnalysisBucket, locale: "vi" | "en", dimension: AnalysisDimension): string {
  if (bucket.option) return optionText({ ...bucket.option, note: null }, locale);
  if (bucket.value)
    return dimension === "country"
      ? countryName(bucket.value, locale)
      : (VALUE_LABEL[bucket.value]?.[locale] ?? bucket.value);
  return NOT_GIVEN[locale];
}

/** The lead analysis to Excel (brief §9): a row per bucket of each dimension, with the notes of "Khác". */
export const leadAnalysisExport: ExportDefinition<AnalysisRow> = {
  list: "lead-analysis",
  title: { vi: "Phân tích lead", en: "Lead analysis" },
  permission: "report.leadAnalysisExport",
  columns: [
    {
      header: { vi: "Chiều phân tích", en: "Dimension" },
      value: ({ dimension }, l) => DIMENSION_LABEL[dimension][l],
      width: 20,
    },
    {
      header: { vi: "Giá trị", en: "Value" },
      value: ({ bucket, dimension }, l) => bucketLabel(bucket, l, dimension),
      width: 28,
    },
    { header: { vi: "Lead", en: "Leads" }, kind: "number", value: ({ bucket }) => bucket.leads },
    { header: { vi: "Đã đặt lịch", en: "Booked" }, kind: "number", value: ({ bucket }) => bucket.booked },
    { header: { vi: "Show", en: "Show" }, kind: "number", value: ({ bucket }) => bucket.showed },
    { header: { vi: "Ký hợp đồng", en: "Contracted" }, kind: "number", value: ({ bucket }) => bucket.contracted },
    {
      header: { vi: "Tỷ lệ đặt lịch (%)", en: "Booking rate (%)" },
      kind: "number",
      value: ({ bucket }) => bucket.bookingRate,
    },
    { header: { vi: "Tỷ lệ show (%)", en: "Show rate (%)" }, kind: "number", value: ({ bucket }) => bucket.showRate },
    {
      header: { vi: 'Ghi chú của "Khác"', en: 'Notes of "Other"' },
      value: ({ bucket }) => bucket.notes.map((entry) => `${entry.note} (${entry.count})`).join("; "),
      width: 40,
    },
  ],
  fetch: async (actor, query, page, pageSize) => {
    const analysis = await leadAnalysis(actor, query);
    const all: AnalysisRow[] = analysis.dimensions.flatMap(({ dimension, buckets }) =>
      buckets.map((bucket) => ({ dimension, bucket })),
    );
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
  },
};
