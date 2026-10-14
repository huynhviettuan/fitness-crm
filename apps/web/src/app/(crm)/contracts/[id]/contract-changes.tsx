import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ScrollTextIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Voucher } from "@flow/shared/changes";
import { HoldButton, RenewalButton } from "../change-dialogs";

/** The change vouchers of a contract, newest first, with the buttons to raise one (M8, brief §5.6). */
export async function ContractChanges({
  contract,
  vouchers,
  canRenew,
  canHold,
}: {
  contract: { id: string; contractCode: string };
  vouchers: Voucher[];
  canRenew: boolean;
  canHold: boolean;
}) {
  const t = await getTranslations("contractChanges");
  return (
    <section aria-labelledby="contract-changes" className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="contract-changes" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {canRenew && <RenewalButton contract={contract} />}
          {canHold && <HoldButton contract={contract} />}
        </div>
      </div>
      {vouchers.length === 0 ? (
        <EmptyState icon={ScrollTextIcon} title={t("empty")} />
      ) : (
        <Table aria-label={t("title")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.voucher")}</TableHead>
              <TableHead>{t("fields.kind")}</TableHead>
              <TableHead>{t("fields.what")}</TableHead>
              <TableHead className="text-right">{t("fields.amount")}</TableHead>
              <TableHead>{t("fields.status")}</TableHead>
              <TableHead>{t("fields.createdBy")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vouchers.map((voucher) => (
              <TableRow key={voucher.id}>
                <TableCell>
                  <span className="font-mono">{voucher.voucherNumber}</span>
                  <div className="text-xs text-muted-foreground">
                    <DateTime value={voucher.createdAt} format="dateTime" />
                  </div>
                </TableCell>
                <TableCell>{t(`kinds.${voucher.kind}`)}</TableCell>
                <TableCell>
                  <VoucherSummary voucher={voucher} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {voucher.amount !== null ? <Money amount={voucher.amount} /> : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge entity="voucher" status={voucher.status} />
                  {voucher.pendingRequestId && (
                    <div className="text-xs">
                      <Link className="underline underline-offset-4" href="/approvals">
                        {t("toApprovals")}
                      </Link>
                    </div>
                  )}
                </TableCell>
                <TableCell>{voucher.createdBy.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

async function VoucherSummary({ voucher }: { voucher: Voucher }) {
  const t = await getTranslations("contractChanges");
  if (voucher.kind === "HOLD" && voucher.fromDate && voucher.toDate) {
    return (
      <span>
        <DateTime value={voucher.fromDate} format="dateOnly" /> – <DateTime value={voucher.toDate} format="dateOnly" />{" "}
        ({t("daysCount", { count: voucher.days ?? 0 })})
      </span>
    );
  }
  const parts = [
    voucher.sessions ? t("sessionsCount", { count: voucher.sessions }) : null,
    voucher.months ? t("monthsCount", { count: voucher.months }) : null,
    voucher.days ? t("daysCount", { count: voucher.days }) : null,
  ].filter(Boolean);
  return <span>{parts.length > 0 ? parts.join(" · ") : "—"}</span>;
}
