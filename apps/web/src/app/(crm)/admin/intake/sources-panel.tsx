"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
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
import { optionLabel } from "@/components/option-select";
import { useErrorMessage } from "@/components/use-error-message";
import { useOptions } from "@/components/use-options";
import type { IntakeSource } from "@flow/shared/intake";
import { createSourceAction, rotateSourceKeyAction, updateSourceAction } from "./actions";

type Props = { sources: IntakeSource[]; branches: { id: string; name: string }[] };

/** The connections: one per source with its own key, shown once (D-044, M10.1). */
export function SourcesPanel({ sources, branches }: Props) {
  const t = useTranslations("intake");
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [adding, setAdding] = useState(false);
  const [shownKey, setShownKey] = useState<string | null>(null);

  const rotate = async (source: IntakeSource) => {
    const result = await rotateSourceKeyAction(source.id);
    if (!result.ok) return notify.error(errorMessage(result.code));
    setShownKey(result.data.key);
    router.refresh();
  };
  const toggle = async (source: IntakeSource) => {
    const result = await updateSourceAction(source.id, {
      name: source.name,
      active: !source.active,
      channelId: source.channel.id,
      sourceId: source.source?.id ?? "",
    });
    if (!result.ok) return notify.error(errorMessage(result.code));
    router.refresh();
  };

  const columns: DataTableColumn<IntakeSource>[] = [
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    { id: "kind", header: t("fields.kind"), cell: ({ row }) => t(`kinds.${row.original.kind}`) },
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    { id: "channel", header: t("fields.channel"), cell: ({ row }) => optionLabel(row.original.channel, locale) },
    {
      id: "source",
      header: t("fields.source"),
      cell: ({ row }) => (row.original.source ? optionLabel(row.original.source, locale) : "—"),
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => (
        <Badge variant={row.original.active ? "success" : "muted"}>
          {row.original.active ? t("active") : t("inactive")}
        </Badge>
      ),
    },
    { id: "received", header: t("fields.received"), cell: ({ row }) => row.original.received },
    {
      id: "last",
      header: t("fields.lastReceived"),
      cell: ({ row }) =>
        row.original.lastReceivedAt ? <DateTime value={row.original.lastReceivedAt} format="dateTime" /> : "—",
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
          {t("add")}
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={sources}
        label={t("title")}
        empty={<p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}
        getRowId={(row) => row.id}
      />
      <p className="mt-3 text-xs text-muted-foreground">{t("note")}</p>
      {adding && (
        <AddSourceDialog
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

function AddSourceDialog({
  branches,
  onClose,
  onCreated,
}: {
  branches: Props["branches"];
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const t = useTranslations("intake");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const channels = useOptions("leadChannels");
  const sources = useOptions("leadSources");
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState(branches.length === 1 ? (branches[0]?.id ?? "") : "");
  const [channelId, setChannelId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const result = await createSourceAction({ name, kind: "WEBSITE", branchId, channelId, sourceId });
    setBusy(false);
    if (!result.ok) return notify.error(errorMessage(result.code));
    onCreated(result.data.key);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("add")}</DialogTitle>
          <DialogDescription>{t("addBody")}</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={t("fields.name")}
          placeholder={t("fields.name")}
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
        <Select value={channelId} onValueChange={setChannelId}>
          <SelectTrigger aria-label={t("fields.channel")}>
            <SelectValue placeholder={t("fields.channel")} />
          </SelectTrigger>
          <SelectContent>
            {(channels ?? [])
              .filter((option) => !option.isOther)
              .map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {optionLabel(option, locale)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={sourceId} onValueChange={setSourceId}>
          <SelectTrigger aria-label={t("fields.source")}>
            <SelectValue placeholder={t("sourcePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {(sources ?? [])
              .filter((option) => !option.isOther)
              .map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {optionLabel(option, locale)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !name.trim() || !branchId || !channelId}>
            {t("register")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The key is shown once and never again (like the machines'). */
function KeyDialog({ value, onClose }: { value: string; onClose: () => void }) {
  const t = useTranslations("intake");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("keyTitle")}</DialogTitle>
          <DialogDescription>{t("keyBody")}</DialogDescription>
        </DialogHeader>
        <code className="rounded-md border bg-muted p-3 text-sm break-all" data-testid="intake-key">
          {value}
        </code>
        <DialogFooter>
          <Button onClick={onClose}>{t("keyDone")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
