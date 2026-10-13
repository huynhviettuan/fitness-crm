"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { CheckinDevice } from "@flow/shared/checkin";
import { createDeviceAction, rotateDeviceKeyAction, updateDeviceAction } from "./actions";

type Props = { devices: CheckinDevice[]; branches: { id: string; name: string }[] };

/** The machines: one per branch with its own key, shown once (D-072). */
export function DevicesPanel({ devices, branches }: Props) {
  const t = useTranslations("checkin");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [adding, setAdding] = useState(false);
  const [shownKey, setShownKey] = useState<string | null>(null);

  const rotate = async (device: CheckinDevice) => {
    const result = await rotateDeviceKeyAction(device.id);
    if (!result.ok) return notify.error(errorMessage(result.code));
    setShownKey(result.data.key);
    router.refresh();
  };
  const toggle = async (device: CheckinDevice) => {
    const result = await updateDeviceAction(device.id, { name: device.name, active: !device.active });
    if (!result.ok) return notify.error(errorMessage(result.code));
    router.refresh();
  };

  const columns: DataTableColumn<CheckinDevice>[] = [
    { id: "name", header: t("fields.device"), cell: ({ row }) => row.original.name },
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant={row.original.active ? "success" : "muted"}>
            {row.original.active ? t("deviceActive") : t("deviceInactive")}
          </Badge>
          {row.original.clockOff && <Badge variant="warning">{t("clockOff")}</Badge>}
        </span>
      ),
    },
    {
      id: "lastSeen",
      header: t("fields.lastSeen"),
      cell: ({ row }) =>
        row.original.lastSeenAt ? <DateTime value={row.original.lastSeenAt} format="dateTime" /> : <span>—</span>,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("fields.actions")}</span>,
      cell: ({ row }) => (
        <span className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => rotate(row.original)}>
            <KeyRoundIcon />
            {t("newKey")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => toggle(row.original)}>
            {row.original.active ? t("deactivate") : t("activate")}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <PlusIcon />
          {t("addDevice")}
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={devices}
        label={t("views.devices")}
        empty={<p className="p-6 text-center text-sm text-muted-foreground">{t("devicesEmpty")}</p>}
        getRowId={(row) => row.id}
      />
      <p className="mt-3 text-xs text-muted-foreground">{t("devicesNote")}</p>
      {adding && (
        <AddDeviceDialog
          branches={branches}
          onClose={() => setAdding(false)}
          onCreated={(key) => {
            setAdding(false);
            setShownKey(key);
            router.refresh();
          }}
        />
      )}
      {shownKey && <KeyDialog value={shownKey} onClose={() => setShownKey(null)} />}
    </>
  );
}

function AddDeviceDialog({
  branches,
  onClose,
  onCreated,
}: {
  branches: Props["branches"];
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const t = useTranslations("checkin");
  const errorMessage = useErrorMessage();
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState(branches.length === 1 ? (branches[0]?.id ?? "") : "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const result = await createDeviceAction({ branchId, name });
    setBusy(false);
    if (!result.ok) return notify.error(errorMessage(result.code));
    onCreated(result.data.key);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addDevice")}</DialogTitle>
          <DialogDescription>{t("addDeviceBody")}</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={t("fields.device")}
          placeholder={t("fields.device")}
        />
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger aria-label={t("fields.branch")}>
            <SelectValue placeholder={t("fields.branch")} />
          </SelectTrigger>
          <SelectContent>
            {branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !name.trim() || !branchId}>
            {t("register")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The key is shown once and never again (D-072). */
function KeyDialog({ value, onClose }: { value: string; onClose: () => void }) {
  const t = useTranslations("checkin");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("keyTitle")}</DialogTitle>
          <DialogDescription>{t("keyBody")}</DialogDescription>
        </DialogHeader>
        <code className="rounded-md border bg-muted p-3 text-sm break-all" data-testid="device-key">
          {value}
        </code>
        <DialogFooter>
          <Button onClick={onClose}>{t("keyDone")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
