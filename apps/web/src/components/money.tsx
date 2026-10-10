import { useLocale } from "next-intl";
import { formatMoney } from "@/lib/format";

type MoneyProps = {
  amount: number | string | { toString(): string };
};

/** The only way money is displayed (docs/23 §5): VND, no decimals. */
export function Money({ amount }: MoneyProps) {
  const locale = useLocale();
  return <span className="tabular-nums">{formatMoney(amount, locale)}</span>;
}
