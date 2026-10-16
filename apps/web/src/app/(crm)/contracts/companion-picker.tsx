"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useCustomerSearch } from "@/components/use-customer-search";

export type Companion = { id: string; label: string };

/**
 * The other members of a group package (A-116): searched by code, name, or phone and added as chips. The API checks that
 * they are customers of the same branch and that the package has room.
 */
export function CompanionPicker({
  value,
  onChange,
  ownerId,
  max,
}: {
  value: Companion[];
  onChange: (next: Companion[]) => void;
  ownerId: string;
  max: number;
}) {
  const t = useTranslations("contracts.form");
  const [query, setQuery] = useState("");
  const results = useCustomerSearch(query, 6).filter(
    (customer) => customer.id !== ownerId && !value.some((picked) => picked.id === customer.id),
  );
  const full = value.length >= max;

  return (
    <Field>
      <FieldLabel htmlFor="companion-search">{t("companions")}</FieldLabel>
      <FieldDescription>{t("companionsHint", { max })}</FieldDescription>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((companion) => (
            <li key={companion.id}>
              <Badge variant="outline" className="gap-1">
                {companion.label}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-muted"
                  aria-label={t("removeCompanion", { name: companion.label })}
                  onClick={() => onChange(value.filter((picked) => picked.id !== companion.id))}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <>
          <Input
            id="companion-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("companionSearch")}
            autoComplete="off"
          />
          {results.length > 0 && (
            <ul className="divide-y rounded-md border">
              {results.map((customer) => (
                <li key={customer.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      onChange([
                        ...value,
                        { id: customer.id, label: `${customer.customerCode} · ${customer.fullName}` },
                      ]);
                      setQuery("");
                    }}
                  >
                    {customer.customerCode} · {customer.fullName}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Field>
  );
}
