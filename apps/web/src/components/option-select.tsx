"use client";

import { useLocale, useTranslations } from "next-intl";
import { useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import type { ChosenOption, Option, OptionListKey } from "@flow/shared/options";
import { SelectField, TextField } from "@/components/form-fields";
import { useOptions } from "@/components/use-options";

/** An option's label in the user's language (D-016: lists carry both). */
export function optionLabel(option: Pick<Option, "labelVi" | "labelEn">, locale: string): string {
  return locale === "vi" ? option.labelVi : option.labelEn;
}

/** A chosen option as a record shows it: its label, then the note written with it. */
export function ChosenOptionText({ option }: { option: ChosenOption }) {
  const locale = useLocale();
  const label = optionLabel(option, locale);
  return <>{option.note ? `${label}: ${option.note}` : label}</>;
}

/** The same text, for messages that take a string. */
export function useChosenOptionText(): (option: ChosenOption) => string {
  const locale = useLocale();
  return (option) => {
    const label = optionLabel(option, locale);
    return option.note ? `${label}: ${option.note}` : label;
  };
}

type OptionSelectProps<T extends FieldValues> = {
  control: Control<T>;
  /** The option field, e.g. `methodId`. */
  name: Path<T>;
  /** Its note field, e.g. `methodNote`. */
  noteName: Path<T>;
  listKey: OptionListKey | null;
  label: string;
  /** For an optional field: the label of a first choice meaning "none", sent as NO_OPTION. */
  noneLabel?: string;
};

/** The value of the "none" choice of an optional OptionSelect; the form sends "" for it. */
export const NO_OPTION = "none";

/**
 * A drop-down from an option list (D-016, docs/23 §8). Choosing "Khác" shows the note,
 * which is then required; the API refuses "Khác" without it (AC-04).
 */
export function OptionSelect<T extends FieldValues>({
  control,
  name,
  noteName,
  listKey,
  label,
  noneLabel,
}: OptionSelectProps<T>) {
  const t = useTranslations("options");
  const locale = useLocale();
  const options = useOptions(listKey);
  const chosenId = useWatch({ control, name });
  const chosen = options?.find((option) => option.id === chosenId);

  return (
    <>
      <SelectField
        control={control}
        name={name}
        label={label}
        placeholder={options ? t("choose") : t("loading")}
        options={[
          ...(noneLabel ? [{ value: NO_OPTION, label: noneLabel }] : []),
          ...(options ?? []).map((option) => ({ value: option.id, label: optionLabel(option, locale) })),
        ]}
      />
      {chosen?.isOther && (
        <TextField
          control={control}
          name={noteName}
          label={t("otherNote")}
          description={t("otherNoteHint")}
          multiline
        />
      )}
    </>
  );
}
