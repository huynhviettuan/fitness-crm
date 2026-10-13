import { getMachineCode } from "@/lib/api/checkin";
import type { CurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import type { MachineSubject } from "@flow/shared/checkin";
import { MachineCodeCard } from "./machine-code-card";

/** The machine user code of a customer or an employee, for Admin only (D-072). */
export async function MachineCodeSection({
  user,
  subject,
  id,
}: {
  user: CurrentUser;
  subject: MachineSubject;
  id: string;
}) {
  if (!can(user, "checkin.devices")) return null;
  const { code } = await getMachineCode(subject, id);
  return <MachineCodeCard subject={subject} id={id} code={code} />;
}
