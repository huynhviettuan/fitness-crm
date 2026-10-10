"use client";

import Form from "next/form";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALL } from "@/lib/filters";

// The left-hand filters of the shared list template (docs/23 §8). Filters are a GET
// form, so the URL holds them and the page reads them on the server.

type FilterPanelProps = {
  /** The page the form submits to, e.g. "/admin/trash". */
  action: string;
  label: string;
  submitLabel: string;
  children: ReactNode;
};

export function FilterPanel({ action, label, submitLabel, children }: FilterPanelProps) {
  return (
    <aside aria-label={label}>
      <Form action={action} className="flex flex-col gap-4">
        {children}
        <Button type="submit" variant="outline">
          {submitLabel}
        </Button>
      </Form>
    </aside>
  );
}

/** A choice filter; the first option is "all" and sends nothing. */
export function FilterSelect({
  name,
  label,
  allLabel,
  value,
  options,
}: {
  name: string;
  label: string;
  allLabel: string;
  value: string | undefined;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select name={name} defaultValue={value ?? ALL}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A text filter, e.g. a day as dd/MM/yyyy. */
export function FilterInput({
  name,
  label,
  value,
  placeholder,
  description,
}: {
  name: string;
  label: string;
  value: string | undefined;
  placeholder?: string;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} defaultValue={value ?? ""} placeholder={placeholder} autoComplete="off" />
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}
