"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { NO_OPTION } from "@/components/option-select";
import { Money } from "@/components/money";
import { notify } from "@/components/notify";
import type { PriceQuote } from "@flow/shared/promotions";
import { quickPackagesInputSchema, type PriceTierVersion, type Service } from "@flow/shared/services";
import { useSubmit } from "../../users/user-dialogs";
import { quotePriceAction, saveQuickPackagesAction } from "../actions";
import { ServiceDialog } from "../service-dialog";
import { TiersDialog } from "./tiers-dialog";

export function EditServiceButton({
  service,
  branches,
}: {
  service: Service;
  branches: { id: string; name: string }[];
}) {
  const t = useTranslations("services");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t("edit")}
      </Button>
      {open && <ServiceDialog service={service} branches={branches} onClose={() => setOpen(false)} />}
    </>
  );
}

type VersionState = "inForce" | "upcoming" | "replaced";
export type VersionView = PriceTierVersion & { state: VersionState };

/** Every version of the price list, newest first; the one in force is marked (BR-301). */
export function TiersPanel({
  serviceId,
  versions,
  canManage,
}: {
  serviceId: string;
  versions: VersionView[];
  canManage: boolean;
}) {
  const t = useTranslations("services.tiers");
  const [open, setOpen] = useState(false);
  const newestFirst = [...versions].reverse();
  const inForce = versions.find((version) => version.state === "inForce") ?? versions.at(-1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("hint")}</p>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            {t("newVersion")}
          </Button>
        )}
      </div>
      {newestFirst.length === 0 && <EmptyState icon={PlusIcon} title={t("empty")} />}
      {newestFirst.map((version) => (
        <Card key={version.id} role="region" aria-label={`v${version.version}`}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <h2>{`v${version.version}`}</h2>
              <Badge
                variant={version.state === "inForce" ? "success" : version.state === "upcoming" ? "info" : "muted"}
              >
                {t(version.state)}
              </Badge>
            </CardTitle>
            <CardDescription>
              {t("startsOn")} <DateTime value={version.effectiveFrom} format="dateOnly" />
              {version.createdBy && ` · ${t("by", { name: version.createdBy })}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TierTable version={version} />
          </CardContent>
        </Card>
      ))}
      {open && <TiersDialog serviceId={serviceId} current={inForce?.tiers ?? []} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TierTable({ version }: { version: PriceTierVersion }) {
  const t = useTranslations("services.tiers");
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table aria-label={`v${version.version}`}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.range")}</TableHead>
            <TableHead>{t("columns.unitPrice")}</TableHead>
            <TableHead>{t("columns.validity")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {version.tiers.map((tier) => (
            <TableRow key={tier.id}>
              <TableCell>
                {tier.maxSessions === null
                  ? t("rangeOpen", { min: tier.minSessions })
                  : t("rangeClosed", { min: tier.minSessions, max: tier.maxSessions })}
              </TableCell>
              <TableCell>
                <Money amount={tier.unitPrice} />
              </TableCell>
              <TableCell>{t("validityText", { months: tier.validityMonths, days: tier.validityDays })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The quick-pick counts: buttons on the contract form that only fill in the sessions (FR-SVC-003). */
export function PackagesPanel({
  serviceId,
  sessions,
  canManage,
}: {
  serviceId: string;
  sessions: number[];
  canManage: boolean;
}) {
  const t = useTranslations("services.packages");
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sessions.map((count) => (
              <li key={count}>
                <Badge variant="outline">{t("unit", { count })}</Badge>
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <Button variant="outline" onClick={() => setOpen(true)}>
            <PencilIcon />
            {t("edit")}
          </Button>
        )}
      </CardContent>
      {open && <PackagesDialog serviceId={serviceId} sessions={sessions} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function PackagesDialog({
  serviceId,
  sessions,
  onClose,
}: {
  serviceId: string;
  sessions: number[];
  onClose: () => void;
}) {
  const t = useTranslations("services.packages");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<{ sessions: string }>({
    // The text "12, 24, 36" is split into the counts the schema checks.
    resolver: (values, context, options) =>
      zodResolver(quickPackagesInputSchema, undefined, { raw: true })(
        { sessions: splitCounts(values.sessions) } as never,
        context,
        options as never,
      ) as never,
    defaultValues: { sessions: sessions.join(", ") },
  });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => saveQuickPackagesAction(serviceId, { sessions: splitCounts(values.sessions) } as never),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("saved"));
        onClose();
        router.refresh();
      },
    ),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("edit")}</DialogTitle>
            <DialogDescription>{t("hint")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <TextField
              control={form.control}
              name="sessions"
              label={t("sessions")}
              description={t("sessionsHint")}
              autoComplete="off"
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : tCommon("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The resolver hands back the values it was given (raw), which are already split.
const splitCounts = (value: string | string[]) =>
  Array.isArray(value) ? value : value.split(/[,;\s]+/).filter((part) => part !== "");

/** Any session count, priced as the contract form does (BR-301, A-110, A-111): tier, promotion, voucher, and VAT. */
export function LookupCard({
  serviceId,
  promotions,
}: {
  serviceId: string;
  /** The promotions on offer for this service. */
  promotions: { id: string; name: string }[];
}) {
  const t = useTranslations("services.lookup");
  const { pending, run } = useSubmit();
  const [result, setResult] = useState<PriceQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{
    sessions: string;
    startDate: string;
    promotionId: string;
    voucherCode: string;
    vatPercent: string;
  }>({ defaultValues: { sessions: "", startDate: "", promotionId: NO_OPTION, voucherCode: "", vatPercent: "" } });

  const onSubmit = form.handleSubmit((values) =>
    run(
      () =>
        quotePriceAction(serviceId, {
          sessions: values.sessions,
          startDate: values.startDate || undefined,
          promotionId: values.promotionId === NO_OPTION ? undefined : values.promotionId,
          voucherCode: values.voucherCode || undefined,
          vatPercent: values.vatPercent || undefined,
        }),
      (fieldErrors) => {
        setResult(null);
        const first = Object.values(fieldErrors ?? {})[0]?.[0];
        setError(first ?? "invalidNumber");
      },
      (found) => {
        setError(null);
        setResult(found);
      },
    ),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} noValidate className="grid items-end gap-4 sm:grid-cols-3">
          <TextField control={form.control} name="sessions" label={t("sessions")} inputMode="numeric" />
          <TextField control={form.control} name="startDate" label={t("startDate")} placeholder="dd/mm/yyyy" />
          <SelectField
            control={form.control}
            name="promotionId"
            label={t("promotion")}
            options={[
              { value: NO_OPTION, label: t("noPromotion") },
              ...promotions.map((promotion) => ({ value: promotion.id, label: promotion.name })),
            ]}
          />
          <TextField control={form.control} name="voucherCode" label={t("voucher")} autoComplete="off" />
          <TextField control={form.control} name="vatPercent" label={t("vat")} inputMode="decimal" />
          <Button type="submit" disabled={pending}>
            {t("run")}
          </Button>
        </form>
        <div aria-live="polite">
          {error && <LookupError code={error} />}
          {result && (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Row label={t("displayName")}>{result.displayName}</Row>
              <Row label={t("version")}>{`v${result.version}`}</Row>
              <Row label={t("unitPrice")}>
                <Money amount={result.unitPrice} />
              </Row>
              <Row label={t("total")}>
                <Money amount={result.breakdown.gross} />
              </Row>
              {result.breakdown.totalDiscount > 0 && (
                <>
                  <Row label={t("discount")}>
                    <Money amount={result.breakdown.totalDiscount} />{" "}
                    {`(${t("discountPercent", { percent: result.discountPercent })})`}
                  </Row>
                  <Row label={t("net")}>
                    <Money amount={result.breakdown.net} />
                  </Row>
                </>
              )}
              {result.breakdown.vatPercent > 0 && (
                <Row label={t("vatAmount")}>
                  <Money amount={result.breakdown.vatAmount} />
                </Row>
              )}
              {(result.breakdown.totalDiscount > 0 || result.breakdown.vatPercent > 0) && (
                <Row label={t("payable")}>
                  <Money amount={result.breakdown.total} />
                </Row>
              )}
              {result.endDate && (
                <Row label={t("endDate")}>
                  <DateTime value={result.endDate} format="dateOnly" />
                </Row>
              )}
            </dl>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LookupError({ code }: { code: string }) {
  const t = useTranslations("validation");
  return (
    <p role="alert" className="text-sm text-destructive">
      {t.has(code as never) ? t(code as never) : code}
    </p>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}
