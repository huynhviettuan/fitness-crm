"use client";

import { useId, type HTMLInputTypeAttribute } from "react";
import { useTranslations } from "next-intl";
import { Controller, type Control, type FieldPath, type FieldValues, type UseFormSetError } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FieldErrors } from "@/lib/api/errors";

type BaseFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
};

/** Schema messages are i18n keys under `validation.*`; show the translation. */
export function useValidationMessage() {
  const t = useTranslations("validation");
  return (key: string) => (t.has(key as Parameters<typeof t>[0]) ? t(key as Parameters<typeof t>[0]) : key);
}

type TextFieldProps<T extends FieldValues> = BaseFieldProps<T> & {
  type?: HTMLInputTypeAttribute;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  multiline?: boolean;
};

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  multiline,
}: TextFieldProps<T>) {
  const id = useId();
  const validationMessage = useValidationMessage();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {multiline ? (
            <Textarea
              {...field}
              id={id}
              value={field.value ?? ""}
              placeholder={placeholder}
              aria-invalid={fieldState.invalid}
            />
          ) : (
            <Input
              {...field}
              id={id}
              type={type}
              value={field.value ?? ""}
              placeholder={placeholder}
              autoComplete={autoComplete}
              inputMode={inputMode}
              aria-invalid={fieldState.invalid}
            />
          )}
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.error?.message && <FieldError>{validationMessage(fieldState.error.message)}</FieldError>}
        </Field>
      )}
    />
  );
}

type SelectFieldProps<T extends FieldValues> = BaseFieldProps<T> & {
  options: { value: string; label: string }[];
  placeholder?: string;
};

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
  placeholder,
}: SelectFieldProps<T>) {
  const id = useId();
  const validationMessage = useValidationMessage();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Select name={field.name} value={field.value ?? ""} onValueChange={field.onChange}>
            <SelectTrigger id={id} aria-invalid={fieldState.invalid} onBlur={field.onBlur} className="w-full">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.error?.message && <FieldError>{validationMessage(fieldState.error.message)}</FieldError>}
        </Field>
      )}
    />
  );
}

/** An on/off choice, e.g. "all branches". */
export function SwitchField<T extends FieldValues>({ control, name, label, description }: BaseFieldProps<T>) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal">
          <Switch id={id} checked={Boolean(field.value)} onCheckedChange={field.onChange} onBlur={field.onBlur} />
          <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {description && <FieldDescription>{description}</FieldDescription>}
          </FieldContent>
        </Field>
      )}
    />
  );
}

type CheckboxListFieldProps<T extends FieldValues> = BaseFieldProps<T> & {
  options: { value: string; label: string }[];
  disabled?: boolean;
};

/** Several values from a short list, e.g. the branches a user works in. */
export function CheckboxListField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
  disabled,
}: CheckboxListFieldProps<T>) {
  const id = useId();
  const validationMessage = useValidationMessage();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const selected: string[] = field.value ?? [];
        const toggle = (value: string, on: boolean) =>
          field.onChange(on ? [...selected, value] : selected.filter((item) => item !== value));
        return (
          <FieldSet data-invalid={fieldState.invalid || undefined}>
            <FieldLegend variant="label">{label}</FieldLegend>
            {description && <FieldDescription>{description}</FieldDescription>}
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((option) => (
                <Field key={option.value} orientation="horizontal">
                  <Checkbox
                    id={`${id}-${option.value}`}
                    checked={selected.includes(option.value)}
                    onCheckedChange={(on) => toggle(option.value, on === true)}
                    disabled={disabled}
                  />
                  <FieldLabel htmlFor={`${id}-${option.value}`} className="font-normal">
                    {option.label}
                  </FieldLabel>
                </Field>
              ))}
            </div>
            {fieldState.error?.message && <FieldError>{validationMessage(fieldState.error.message)}</FieldError>}
          </FieldSet>
        );
      }}
    />
  );
}

/** Shows field errors returned by a Server Action next to their fields. */
export function applyFieldErrors<T extends FieldValues>(setError: UseFormSetError<T>, fieldErrors?: FieldErrors) {
  if (!fieldErrors) return;
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages?.[0]) setError(field as FieldPath<T>, { message: messages[0] });
  }
}
