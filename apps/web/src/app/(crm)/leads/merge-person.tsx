"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MergeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { applyFieldErrors, useValidationMessage } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { OptionSelect } from "@/components/option-select";
import { mergeInputSchema } from "@flow/shared/leads";
import { useSubmit } from "../admin/users/user-dialogs";
import { mergePersonsAction } from "./actions";

type Candidate = { id: string; stage: "LEAD" | "CUSTOMER"; code: string; fullName: string; phone: string | null };

const MIN_QUERY = 2;

/** Leads and customers matching `query` by code, name, or phone, except the record itself; fetched as the user types. */
function usePersonSearch(query: string, excludeId: string): Candidate[] {
  const [results, setResults] = useState<Candidate[]>([]);
  const term = query.trim();

  useEffect(() => {
    if (term.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const get = async (path: string, key: string) => {
        const response = await fetch(`/api/v1/${path}?${key}=${encodeURIComponent(term)}&pageSize=6`, {
          signal: controller.signal,
        });
        return response.ok ? ((await response.json()).items as Record<string, string | null>[]) : [];
      };
      try {
        // A role without customer.view simply gets no customers (the API answers 403).
        const [leads, customers] = await Promise.all([get("leads", "q"), get("customers", "search")]);
        setResults([
          ...leads.map((lead) => ({
            id: lead.id as string,
            stage: "LEAD" as const,
            code: lead.leadCode as string,
            fullName: lead.fullName as string,
            phone: lead.phone,
          })),
          ...customers.map((customer) => ({
            id: customer.id as string,
            stage: "CUSTOMER" as const,
            code: customer.customerCode as string,
            fullName: customer.fullName as string,
            phone: customer.phone,
          })),
        ]);
      } catch {
        // Aborted by a newer query; nothing to do.
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  return term.length < MIN_QUERY ? [] : results.filter((result) => result.id !== excludeId);
}

type MergeValues = { mergedId: string; reasonId: string; reasonNote: string };

/**
 * A manager merges a duplicate record into this one (BR-202, A-064): the customer is kept,
 * or of two leads the older one, so the page may open the other record afterwards.
 */
export function MergePersonButton({ person }: { person: { id: string; fullName: string; code: string } }) {
  const t = useTranslations("leads.merge");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MergeIcon />
        {t("action")}
      </Button>
      {open && <MergeDialog person={person} onClose={() => setOpen(false)} />}
    </>
  );
}

function MergeDialog({
  person,
  onClose,
}: {
  person: { id: string; fullName: string; code: string };
  onClose: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const validationMessage = useValidationMessage();
  const { pending, run } = useSubmit();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const results = usePersonSearch(query, person.id);
  const form = useForm<MergeValues>({
    resolver: zodResolver(mergeInputSchema, undefined, { raw: true }) as never,
    defaultValues: { mergedId: "", reasonId: "", reasonNote: "" },
  });
  const mergedError = form.formState.errors.mergedId?.message;
  useWatch({ control: form.control, name: "mergedId" });

  const choose = (candidate: Candidate | null) => {
    setChosen(candidate);
    form.setValue("mergedId", candidate?.id ?? "", { shouldValidate: form.formState.isSubmitted });
  };
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => mergePersonsAction(person.id, values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      (result) => {
        notify.success(t("leads.merge.done"));
        onClose();
        router.push(result.stage === "LEAD" ? `/leads/${result.survivorId}` : `/customers/${result.survivorId}`);
        router.refresh();
      },
    ),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("leads.merge.title", { name: person.fullName })}</DialogTitle>
            <DialogDescription>{t("leads.merge.description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {chosen ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <span>
                  <span className="text-muted-foreground">{t("leads.merge.chosen")}: </span>
                  <span className="font-medium">{chosen.fullName}</span>{" "}
                  <span className="font-mono text-xs">{chosen.code}</span>{" "}
                  <span className="text-muted-foreground">({t(`leads.merge.stage.${chosen.stage}`)})</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => choose(null)}>
                  {t("leads.merge.change")}
                </Button>
              </div>
            ) : (
              <Field data-invalid={mergedError ? true : undefined}>
                <FieldLabel htmlFor="merge-search">{t("leads.merge.search")}</FieldLabel>
                <Input
                  id="merge-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("leads.merge.searchHint")}
                  autoComplete="off"
                />
                {mergedError && <FieldError>{validationMessage(mergedError)}</FieldError>}
                {query.trim().length >= MIN_QUERY && (
                  <ul className="divide-y rounded-md border" aria-label={t("leads.merge.search")}>
                    {results.length === 0 && (
                      <li className="p-3 text-sm text-muted-foreground">{t("leads.merge.noMatches")}</li>
                    )}
                    {results.map((candidate) => (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          onClick={() => choose(candidate)}
                          className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm hover:bg-accent"
                        >
                          <span>
                            <span className="font-medium">{candidate.fullName}</span>{" "}
                            <span className="font-mono text-xs">{candidate.code}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t(`leads.merge.stage.${candidate.stage}`)}
                            {candidate.phone ? ` · ${candidate.phone}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
            )}
            <OptionSelect
              control={form.control}
              name="reasonId"
              noteName="reasonNote"
              listKey="deleteReasons"
              label={t("leads.merge.reason")}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("leads.merge.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
