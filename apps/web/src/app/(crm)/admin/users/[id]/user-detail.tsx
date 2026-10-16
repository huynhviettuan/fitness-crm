"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { CheckboxListField, SelectField, SwitchField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { StatusBadge } from "@/components/status-badge";
import { PERMISSION_GROUPS, type Permission, type PermissionGroup } from "@gymcrm/shared/permissions";
import { WEEKDAYS } from "@gymcrm/shared/users";
import {
  changeUserRoleAction,
  setUserAccessHoursAction,
  setUserBranchesAction,
  setUserOverridesAction,
} from "../actions";
import { useSubmit, type Option } from "../user-dialogs";

type Target = { id: string; role: { id: string; name: string }; allBranches: boolean; branches: Option[] };

/** Role and branches (FR-PLT-001, D-014). Each saves on its own. */
export function UserAccessForm({
  user,
  roles,
  branches,
  readOnly,
}: {
  user: Target;
  roles: Option[];
  branches: Option[];
  readOnly: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const role = useSubmit();
  const access = useSubmit();
  const roleForm = useForm<{ roleId: string }>({ defaultValues: { roleId: user.role.id } });
  const branchForm = useForm<{ allBranches: boolean; branchIds: string[] }>({
    defaultValues: { allBranches: user.allBranches, branchIds: user.branches.map((b) => b.id) },
  });
  const allBranches = useWatch({ control: branchForm.control, name: "allBranches" });

  const saveRole = roleForm.handleSubmit(({ roleId }) =>
    role.run(
      () => changeUserRoleAction({ userId: user.id, roleId }),
      (fieldErrors) => applyFieldErrors(roleForm.setError, fieldErrors),
      () => {
        notify.success(t("users.roleChanged"));
        router.refresh();
      },
    ),
  );
  const saveBranches = branchForm.handleSubmit((values) =>
    access.run(
      () =>
        setUserBranchesAction({ userId: user.id, ...values, branchIds: values.allBranches ? [] : values.branchIds }),
      (fieldErrors) => applyFieldErrors(branchForm.setError, fieldErrors),
      () => {
        notify.success(t("users.branchesSaved"));
        router.refresh();
      },
    ),
  );

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <form onSubmit={saveRole}>
          <CardHeader>
            <CardTitle>
              <h2>{t("users.fields.role")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SelectField
              control={roleForm.control}
              name="roleId"
              label={t("users.fields.role")}
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
            />
          </CardContent>
          {!readOnly && (
            <CardFooter className="justify-end">
              <Button type="submit" disabled={role.pending}>
                {role.pending ? t("common.saving") : t("common.save")}
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>
      <Card>
        <form onSubmit={saveBranches} noValidate>
          <CardHeader>
            <CardTitle>
              <h2>{t("users.fields.branches")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <SwitchField
                control={branchForm.control}
                name="allBranches"
                label={t("users.allBranches")}
                description={t("users.allBranchesHint")}
              />
              {!allBranches && (
                <CheckboxListField
                  control={branchForm.control}
                  name="branchIds"
                  label={t("users.fields.branches")}
                  options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
                />
              )}
            </FieldGroup>
          </CardContent>
          {!readOnly && (
            <CardFooter className="justify-end">
              <Button type="submit" disabled={access.pending}>
                {access.pending ? t("common.saving") : t("common.save")}
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>
    </div>
  );
}

type Choice = "inherit" | "on" | "off";

/** FR-PLT-003: single permissions switched on or off for this user; the rest follow the role. */
export function OverridesForm({
  userId,
  roleName,
  rolePermissions,
  overrides,
  readOnly,
}: {
  userId: string;
  roleName: string;
  rolePermissions: Permission[];
  overrides: { permission: Permission; granted: boolean }[];
  readOnly: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const [choices, setChoices] = useState<Partial<Record<Permission, Choice>>>(() =>
    Object.fromEntries(overrides.map((o) => [o.permission, o.granted ? "on" : "off"])),
  );

  const save = () =>
    run(
      () =>
        setUserOverridesAction({
          userId,
          overrides: Object.entries(choices)
            .filter(([, choice]) => choice !== "inherit")
            .map(([permission, choice]) => ({ permission, granted: choice === "on" })),
        }),
      () => {},
      () => {
        notify.success(t("users.overrides.saved"));
        router.refresh();
      },
    );

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>
          <h2>{t("users.tabs.permissions")}</h2>
        </CardTitle>
        <CardDescription>{t("users.overrides.description", { role: roleName })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {(Object.keys(PERMISSION_GROUPS) as PermissionGroup[]).map((group) => (
          <section key={group} aria-labelledby={`group-${group}`} className="space-y-2">
            <h3 id={`group-${group}`} className="text-sm font-semibold">
              {t(`permissions.groups.${group}`)}
            </h3>
            <ul className="divide-y rounded-md border">
              {PERMISSION_GROUPS[group].map((permission) => {
                const roleHas = rolePermissions.includes(permission);
                return (
                  <li key={permission} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm" id={`perm-${permission}`}>
                      {t(`permissions.labels.${permission}`)}
                    </span>
                    <Select
                      value={choices[permission] ?? "inherit"}
                      onValueChange={(value) =>
                        setChoices((current) => ({ ...current, [permission]: value as Choice }))
                      }
                      disabled={readOnly}
                    >
                      <SelectTrigger className="w-56" aria-labelledby={`perm-${permission}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">
                          {t("users.overrides.inherit", {
                            value: roleHas ? t("users.overrides.granted") : t("users.overrides.notGranted"),
                          })}
                        </SelectItem>
                        <SelectItem value="on">{t("users.overrides.on")}</SelectItem>
                        <SelectItem value="off">{t("users.overrides.off")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </CardContent>
      {!readOnly && (
        <CardFooter className="justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

type Window = { weekdays: number[]; startTime: string; endTime: string };

/** D-017: the days and times (gym time) the user may sign in; none means any time. */
export function AccessHoursForm({
  userId,
  windows: initial,
  readOnly,
}: {
  userId: string;
  windows: Window[];
  readOnly: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const { pending, run } = useSubmit();
  const [windows, setWindows] = useState<Window[]>(initial);

  const update = (index: number, patch: Partial<Window>) =>
    setWindows((current) => current.map((window, i) => (i === index ? { ...window, ...patch } : window)));
  const toggleDay = (index: number, day: number, on: boolean) =>
    update(index, {
      weekdays: on ? [...windows[index].weekdays, day].sort() : windows[index].weekdays.filter((d) => d !== day),
    });

  const save = () =>
    run(
      () => setUserAccessHoursAction({ userId, windows }),
      () => {},
      () => {
        notify.success(t("users.accessHours.saved"));
        router.refresh();
      },
    );

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>
          <h2>{t("users.tabs.accessHours")}</h2>
        </CardTitle>
        <CardDescription>{t("users.accessHours.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {windows.length === 0 && <p className="text-sm text-muted-foreground">{t("users.accessHours.none")}</p>}
        {windows.map((window, index) => (
          <fieldset
            key={index}
            className="space-y-3 rounded-md border p-3"
            aria-label={`${t("users.tabs.accessHours")} ${index + 1}`}
          >
            <div className="flex flex-wrap gap-3" role="group" aria-label={t("users.accessHours.weekdays")}>
              {WEEKDAYS.map((day) => (
                <Field key={day} orientation="horizontal" className="w-auto">
                  <Checkbox
                    id={`${id}-${index}-${day}`}
                    checked={window.weekdays.includes(day)}
                    onCheckedChange={(on) => toggleDay(index, day, on === true)}
                    disabled={readOnly}
                  />
                  <FieldLabel htmlFor={`${id}-${index}-${day}`} className="font-normal">
                    {t(`users.accessHours.days.${day}`)}
                  </FieldLabel>
                </Field>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-32">
                <FieldLabel htmlFor={`${id}-${index}-from`}>{t("users.accessHours.from")}</FieldLabel>
                <Input
                  id={`${id}-${index}-from`}
                  type="time"
                  value={window.startTime}
                  onChange={(event) => update(index, { startTime: event.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field className="w-32">
                <FieldLabel htmlFor={`${id}-${index}-to`}>{t("users.accessHours.to")}</FieldLabel>
                <Input
                  id={`${id}-${index}-to`}
                  type="time"
                  value={window.endTime}
                  onChange={(event) => update(index, { endTime: event.target.value })}
                  disabled={readOnly}
                />
              </Field>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("users.accessHours.remove")}
                  onClick={() => setWindows((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2Icon />
                </Button>
              )}
            </div>
          </fieldset>
        ))}
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setWindows((current) => [
                ...current,
                { weekdays: [1, 2, 3, 4, 5, 6], startTime: "08:00", endTime: "17:30" },
              ])
            }
          >
            <PlusIcon />
            {t("users.accessHours.add")}
          </Button>
        )}
      </CardContent>
      {!readOnly && (
        <CardFooter className="justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? t("common.saving") : t("common.save")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

type LoginRow = {
  id: string;
  at: Date;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
};
const REASONS = ["WRONG_PASSWORD", "UNKNOWN_USER", "DISABLED", "OUTSIDE_HOURS"] as const;

/** D-017: the latest sign-in attempts, newest first. */
export function LoginHistory({ events }: { events: LoginRow[] }) {
  const t = useTranslations("users.logins");
  const reasonLabel = (reason: string | null) =>
    reason && (REASONS as readonly string[]).includes(reason)
      ? t(`reasons.${reason as (typeof REASONS)[number]}`)
      : reason;

  const columns: DataTableColumn<LoginRow>[] = [
    { id: "at", header: t("at"), cell: ({ row }) => <DateTime value={row.original.at} format="dateTime" /> },
    {
      id: "result",
      header: t("result"),
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge entity="login" status={row.original.success ? "SUCCESS" : "FAILED"} />
          {!row.original.success && (
            <span className="text-sm text-muted-foreground">{reasonLabel(row.original.reason)}</span>
          )}
        </span>
      ),
    },
    { id: "ip", header: t("ip"), cell: ({ row }) => row.original.ip },
    {
      id: "device",
      header: t("device"),
      cell: ({ row }) => (
        <span className="line-clamp-1 max-w-xs text-sm text-muted-foreground">{row.original.userAgent}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={events}
      label={t("at")}
      empty={<EmptyState title={t("empty")} />}
      getRowId={(row) => row.id}
    />
  );
}
