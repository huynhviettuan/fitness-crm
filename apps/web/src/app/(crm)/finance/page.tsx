import { redirect } from "next/navigation";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export default function FinancePage() {
  redirect("/finance/payments");
}
