import type { EmailLocale } from "@flow/shared/mail";

// What a customer is told when a change moves their session count (D-036, AC-17). The wording of every email is
// edited by admin from M6.2; until then these two texts, in the customer's language, say what happened and what is
// left, so no change reaches the customer silently.

export type SessionChangeEmail = {
  kind: "refunded" | "added";
  customerName: string;
  contractCode: string;
  /** dd/MM/yyyy, the gym day of the session. */
  day: string;
  remaining: number;
};

const TEXTS = {
  vi: {
    refunded: (e: SessionChangeEmail) => ({
      subject: `Hoàn lại 1 buổi tập, hợp đồng ${e.contractCode}`,
      body: `Chào ${e.customerName},\n\nBuổi tập ngày ${e.day} của hợp đồng ${e.contractCode} đã được xóa khỏi lịch sử tập và hoàn lại 1 buổi. Số buổi còn lại: ${e.remaining}.\n\nNếu có điều gì chưa đúng, xin liên hệ phòng tập.`,
    }),
    added: (e: SessionChangeEmail) => ({
      subject: `Ghi nhận thêm 1 buổi tập, hợp đồng ${e.contractCode}`,
      body: `Chào ${e.customerName},\n\nPhòng tập vừa ghi nhận thêm 1 buổi tập ngày ${e.day} vào hợp đồng ${e.contractCode}. Số buổi còn lại: ${e.remaining}.\n\nNếu có điều gì chưa đúng, xin liên hệ phòng tập.`,
    }),
  },
  en: {
    refunded: (e: SessionChangeEmail) => ({
      subject: `1 session refunded, contract ${e.contractCode}`,
      body: `Hello ${e.customerName},\n\nThe session of ${e.day} on contract ${e.contractCode} was removed from your training history and 1 session was refunded. Sessions left: ${e.remaining}.\n\nIf anything looks wrong, please contact the gym.`,
    }),
    added: (e: SessionChangeEmail) => ({
      subject: `1 session recorded, contract ${e.contractCode}`,
      body: `Hello ${e.customerName},\n\nThe gym recorded 1 more session of ${e.day} on contract ${e.contractCode}. Sessions left: ${e.remaining}.\n\nIf anything looks wrong, please contact the gym.`,
    }),
  },
} as const;

export function sessionChangeEmail(locale: EmailLocale, email: SessionChangeEmail) {
  return TEXTS[locale][email.kind](email);
}

/** dd/MM/yyyy of a gym day held as UTC midnight. */
export function formatDay(day: Date): string {
  const [year, month, date] = day.toISOString().slice(0, 10).split("-");
  return `${date}/${month}/${year}`;
}
