"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UsersRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { notify } from "@/components/notify";
import { LEAD_WEIGHT_MAX, type LeadReceiver } from "@flow/shared/leads";
import { useSubmit } from "../../admin/users/user-dialogs";
import { setLeadReceiverAction } from "./actions";

/** One consultant: the switch and the weight are saved together on their row (D-050). */
function ReceiverControls({ receiver }: { receiver: LeadReceiver }) {
  const t = useTranslations("leadReceivers");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const [receives, setReceives] = useState(receiver.receivesLeads);
  const [weight, setWeight] = useState(String(receiver.leadWeight));
  const invalid = !/^\d{1,2}$/.test(weight) || Number(weight) < 1 || Number(weight) > LEAD_WEIGHT_MAX;
  const changed = receives !== receiver.receivesLeads || weight !== String(receiver.leadWeight);

  const save = () =>
    run(
      () => setLeadReceiverAction(receiver.id, { receivesLeads: receives, leadWeight: Number(weight) }),
      () => {},
      () => {
        notify.success(t("saved", { name: receiver.name }));
        router.refresh();
      },
    );

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Switch
        aria-label={t("receivesFor", { name: receiver.name })}
        checked={receives}
        onCheckedChange={setReceives}
        disabled={pending}
      />
      <div>
        <Label htmlFor={`weight-${receiver.id}`} className="sr-only">
          {t("weightFor", { name: receiver.name })}
        </Label>
        <Input
          id={`weight-${receiver.id}`}
          inputMode="numeric"
          className="w-20"
          value={weight}
          aria-invalid={invalid}
          disabled={pending}
          onChange={(event) => setWeight(event.target.value)}
        />
        {invalid && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {tv("outOfRange")}
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || invalid || !changed}
        onClick={save}
        aria-label={t("saveFor", { name: receiver.name })}
      >
        {pending ? tc("saving") : tc("save")}
      </Button>
    </div>
  );
}

/** The consultants who receive leads: who is on duty now, how many leads they hold, the switch, and the weight. */
export function ReceiversTable({ receivers }: { receivers: LeadReceiver[] }) {
  const t = useTranslations("leadReceivers");
  const columns: DataTableColumn<LeadReceiver>[] = [
    { id: "name", header: t("name"), cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    {
      id: "branches",
      header: t("branches"),
      cell: ({ row }) =>
        row.original.allBranches ? t("allBranches") : row.original.branches.map((branch) => branch.name).join(", "),
    },
    { id: "inCharge", header: t("inCharge"), cell: ({ row }) => row.original.leadsInCharge },
    {
      id: "onDuty",
      header: t("onDuty"),
      cell: ({ row }) => (
        <Badge variant={row.original.onDuty ? "default" : "outline"}>
          {row.original.onDuty ? t("onDutyYes") : t("onDutyNo")}
        </Badge>
      ),
    },
    {
      id: "controls",
      header: t("turn"),
      // A saved row starts again from what the server holds.
      cell: ({ row }) => (
        <ReceiverControls key={`${row.original.receivesLeads}-${row.original.leadWeight}`} receiver={row.original} />
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={receivers}
      label={t("title")}
      empty={<EmptyState icon={UsersRoundIcon} title={t("empty")} />}
      getRowId={(row) => row.id}
    />
  );
}
