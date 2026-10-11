"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MIN_CUSTOMER_QUERY_LENGTH, useCustomerSearch } from "@/components/use-customer-search";

/** Global customer search, opened with Ctrl+K (FR-CUS-002, docs/23 §6). */
export function CustomerSearch() {
  const t = useTranslations("search");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useCustomerSearch(query);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) setQuery("");
  };

  const select = (id: string) => {
    changeOpen(false);
    router.push(`/customers/${id}`);
  };

  const tooShort = query.trim().length < MIN_CUSTOMER_QUERY_LENGTH;

  return (
    <>
      <Button
        variant="outline"
        className="h-9 w-full min-w-0 max-w-72 justify-start gap-2 text-muted-foreground"
        onClick={() => changeOpen(true)}
      >
        <SearchIcon />
        <span className="truncate">{t("trigger")}</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">{t("shortcut")}</kbd>
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="top-1/3 translate-y-0 overflow-hidden p-0" showCloseButton={false}>
          <DialogTitle className="sr-only">{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("hint")}</DialogDescription>
          {/* Results come from the server, so cmdk's own filtering is off. */}
          <Command shouldFilter={false}>
            <CommandInput placeholder={t("placeholder")} value={query} onValueChange={setQuery} />
            <CommandList>
              {tooShort ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("hint")}</p>
              ) : (
                <CommandEmpty>{t("empty")}</CommandEmpty>
              )}
              {!tooShort &&
                results.map((customer) => (
                  <CommandItem key={customer.id} value={customer.id} onSelect={select}>
                    <span className="font-mono text-xs text-muted-foreground">{customer.customerCode}</span>
                    <span className="truncate">{customer.fullName}</span>
                    {customer.phone && <span className="ml-auto text-xs text-muted-foreground">{customer.phone}</span>}
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
