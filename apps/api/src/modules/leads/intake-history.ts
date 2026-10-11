import type { LeadInquiry, PersonIntakeHistory } from "@flow/shared/leads";
import type { Db } from "../../platform/db/prisma.js";
import { chosen } from "../../platform/options/option.service.js";
import * as repo from "./merge.repository.js";

// What the timeline and the customer page show of a person's later inquiries and merges (BR-202, A-064).

type MergeEntry = Extract<PersonIntakeHistory["items"][number], { kind: "merge" }>;

export function inquiryView(inquiry: repo.InquiryRecord): LeadInquiry {
  return {
    kind: "inquiry",
    id: inquiry.id,
    at: inquiry.createdAt,
    by: inquiry.createdBy,
    channel: chosen(inquiry.channel, inquiry.channelNote),
    source: inquiry.source ? chosen(inquiry.source, inquiry.sourceNote) : null,
    sourceType: inquiry.sourceType,
    sourceDetail: inquiry.sourceDetail,
    needGroup: inquiry.needGroup ? chosen(inquiry.needGroup, inquiry.needGroupNote) : null,
    needDetail: inquiry.needDetail,
    note: inquiry.note,
  };
}

function mergeView(merge: repo.MergeRecord): MergeEntry {
  return {
    kind: "merge",
    id: merge.id,
    at: merge.createdAt,
    by: merge.mergedBy,
    mergedLeadCode: merge.merged.leadCode,
    mergedCustomerCode: merge.merged.customerCode,
    mergedName: merge.merged.fullName,
    reason: chosen(merge.reason, merge.reasonNote),
  };
}

/** Inquiries and merges of one person, newest first. */
export async function intakeEntries(db: Db, personId: string): Promise<PersonIntakeHistory["items"]> {
  const [inquiries, merges] = await Promise.all([repo.inquiriesOf(db, personId), repo.mergesInto(db, personId)]);
  return [...inquiries.map(inquiryView), ...merges.map(mergeView)].sort((a, b) => b.at.getTime() - a.at.getTime());
}
