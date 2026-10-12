"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useValidationMessage } from "@/components/form-fields";
import { notify } from "@/components/notify";
import {
  DATA_SCOPES,
  DATA_SCOPE_RESOURCES,
  MASKABLE_FIELDS,
  PERMISSION_GROUPS,
  type DataScope,
  type DataScopeResource,
  type MaskableField,
  type Permission,
  type PermissionGroup,
} from "@flow/shared/permissions";
import { useSubmit } from "../users/user-dialogs";
import { cloneRoleAction, createRoleAction, updateRoleAction } from "./actions";

export type EditableRole = {
  id: string | null;
  name: string;
  description: string | null;
  /** The largest discount, as a percent of the tier price, the role may approve itself (A-112). */
  discountThresholdPct: number;
  permissions: Permission[];
  dataScopes: Record<DataScopeResource, DataScope>;
  fieldMasks: MaskableField[];
};

/**
 * FR-PLT-002: one role's permissions (the tree, module by module), data scope per
 * resource, and hidden fields. Saving replaces the role's configuration; it applies to
 * the role's users on their next request.
 */
export function RoleEditor({ role }: { role: EditableRole }) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const validationMessage = useValidationMessage();
  const { pending, run } = useSubmit();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [permissions, setPermissions] = useState<Set<Permission>>(new Set(role.permissions));
  const [dataScopes, setDataScopes] = useState(role.dataScopes);
  const [fieldMasks, setFieldMasks] = useState<Set<MaskableField>>(new Set(role.fieldMasks));
  const [discountThreshold, setDiscountThreshold] = useState(String(role.discountThresholdPct));
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const toggle = <T,>(set: Set<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  const toggleGroup = (group: PermissionGroup, on: boolean) =>
    setPermissions((current) =>
      PERMISSION_GROUPS[group].reduce((set, permission) => toggle(set, permission, on), current),
    );

  const save = () => {
    setNameError(null);
    setThresholdError(null);
    const input = {
      name,
      description,
      discountThresholdPct: discountThreshold,
      permissions: [...permissions],
      dataScopes,
      fieldMasks: [...fieldMasks],
    };
    const showErrors = (fieldErrors?: Record<string, string[]>) => {
      setNameError(fieldErrors?.name?.[0] ?? null);
      setThresholdError(fieldErrors?.discountThresholdPct?.[0] ?? null);
    };
    if (role.id) {
      const roleId = role.id;
      run(
        () => updateRoleAction(roleId, input),
        showErrors,
        () => {
          notify.success(t("roles.saved"));
          router.refresh();
        },
      );
    } else {
      run(
        () => createRoleAction(input),
        showErrors,
        (created) => {
          notify.success(t("roles.created", { name: created.name }));
          router.push(`/admin/roles/${created.id}`);
        },
      );
    }
  };

  return (
    <div className="grid max-w-4xl gap-6">
      <Card>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={nameError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-name`}>{t("roles.fields.name")}</FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={Boolean(nameError)}
              />
              {nameError && <FieldError>{validationMessage(nameError)}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-description`}>{t("roles.fields.description")}</FieldLabel>
              <Textarea
                id={`${id}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field data-invalid={thresholdError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-threshold`}>{t("roles.fields.discountThresholdPct")}</FieldLabel>
              <Input
                id={`${id}-threshold`}
                value={discountThreshold}
                onChange={(event) => setDiscountThreshold(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={Boolean(thresholdError)}
                className="max-w-32"
              />
              <FieldDescription>{t("roles.discountThresholdHint")}</FieldDescription>
              {thresholdError && <FieldError>{validationMessage(thresholdError)}</FieldError>}
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("roles.fields.permissions")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {(Object.keys(PERMISSION_GROUPS) as PermissionGroup[]).map((group) => {
            const keys = PERMISSION_GROUPS[group] as readonly Permission[];
            const checked = keys.filter((key) => permissions.has(key)).length;
            return (
              <div key={group} role="group" aria-labelledby={`${id}-${group}-label`} className="space-y-2">
                <Field orientation="horizontal">
                  <Checkbox
                    id={`${id}-${group}`}
                    checked={checked === keys.length ? true : checked > 0 ? "indeterminate" : false}
                    onCheckedChange={(on) => toggleGroup(group, on === true)}
                  />
                  <FieldLabel id={`${id}-${group}-label`} htmlFor={`${id}-${group}`} className="font-semibold">
                    {t(`permissions.groups.${group}`)}
                  </FieldLabel>
                </Field>
                <div className="space-y-2 pl-6">
                  {keys.map((permission) => (
                    <Field key={permission} orientation="horizontal">
                      <Checkbox
                        id={`${id}-${permission}`}
                        checked={permissions.has(permission)}
                        onCheckedChange={(on) => setPermissions((current) => toggle(current, permission, on === true))}
                      />
                      <FieldLabel htmlFor={`${id}-${permission}`} className="font-normal">
                        {t(`permissions.labels.${permission}`)}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("roles.fields.dataScopes")}</h2>
          </CardTitle>
          <CardDescription>{t("roles.fields.dataScopesHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {DATA_SCOPE_RESOURCES.map((resource) => (
            <Field key={resource}>
              <FieldLabel htmlFor={`${id}-scope-${resource}`}>{t(`permissions.resources.${resource}`)}</FieldLabel>
              <Select
                value={dataScopes[resource]}
                onValueChange={(value) => setDataScopes((current) => ({ ...current, [resource]: value as DataScope }))}
              >
                <SelectTrigger id={`${id}-scope-${resource}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_SCOPES.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {t(`permissions.scopes.${scope}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("roles.fields.fieldMasks")}</h2>
          </CardTitle>
          <CardDescription>{t("roles.fields.fieldMasksHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {MASKABLE_FIELDS.map((field) => (
            <Field key={field} orientation="horizontal">
              <Checkbox
                id={`${id}-mask-${field}`}
                checked={fieldMasks.has(field)}
                onCheckedChange={(on) => setFieldMasks((current) => toggle(current, field, on === true))}
              />
              <FieldLabel htmlFor={`${id}-mask-${field}`} className="font-normal">
                {t(`permissions.masks.${field}`)}
              </FieldLabel>
            </Field>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

/** A copy under a new name, opened for editing (FR-PLT-002). */
export function CloneRoleButton({ role }: { role: { id: string; name: string } }) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const validationMessage = useValidationMessage();
  const { pending, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run(
      () => cloneRoleAction(role.id, { name }),
      (fieldErrors) => setError(fieldErrors?.name?.[0] ?? null),
      (created) => {
        notify.success(t("roles.cloned", { name: created.name }));
        setOpen(false);
        router.push(`/admin/roles/${created.id}`);
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CopyIcon />
        {t("roles.clone")}
      </Button>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("roles.cloneTitle", { name: role.name })}</DialogTitle>
            <DialogDescription>{t("roles.cloneDescription")}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`${id}-clone-name`}>{t("roles.fields.name")}</FieldLabel>
            <Input
              id={`${id}-clone-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={Boolean(error)}
            />
            {error && <FieldError>{validationMessage(error)}</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("roles.clone")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
