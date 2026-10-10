"use client";

import { useId, type HTMLInputTypeAttribute } from "react";
import { useTranslations } from "next-intl";
import { Controller, type Control, type FieldPath, type FieldValues, type UseFormSetError } from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
            <Textarea {...field} id={id} value={field.value ?? ""} placeholder={placeholder} aria-invalid={fieldState.invalid} />
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

/** Shows field errors returned by a Server Action next to their fields. */
export function applyFieldErrors<T extends FieldValues>(setError: UseFormSetError<T>, fieldErrors?: FieldErrors) {
  if (!fieldErrors) return;
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages?.[0]) setError(field as FieldPath<T>, { message: messages[0] });
  }
}
