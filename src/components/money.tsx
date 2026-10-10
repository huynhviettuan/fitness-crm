import { useLocale } from "next-intl";
import { cn } from "cn";
import { formatMoney } from "@/lib/format";

type MoneyProps = {
  amount: number | string | { toString(): string };
  /** A voided amount: shown struck through and muted (docs/23 §3). */
  struck?: boolean;
};

/** The only way money is displayed (docs/23 §5): VND, no decimals. */
export function Money({ amount, struck }: MoneyProps) {
  const locale = useLocale();
  return <span className={cn("tabular-nums", struck && "text-muted-foreground line-through")}>{formatMoney(amount, locale)}</span>;
}
