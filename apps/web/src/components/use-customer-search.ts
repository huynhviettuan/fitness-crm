"use client";

import { useEffect, useState } from "react";

export type CustomerSearchResult = { id: string; customerCode: string; fullName: string; phone: string };

export const MIN_CUSTOMER_QUERY_LENGTH = 2;

/**
 * Customers matching `query` by code, name, or phone (FR-CUS-002), fetched from the
 * API as the user types. Only the latest query's results are kept.
 */
export function useCustomerSearch(query: string, limit = 8): CustomerSearchResult[] {
  const [results, setResults] = useState<CustomerSearchResult[]>([]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_CUSTOMER_QUERY_LENGTH) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ search: term, pageSize: String(limit) });
      try {
        const response = await fetch(`/api/v1/customers?${params}`, { signal: controller.signal });
        if (response.ok) setResults((await response.json()).items);
      } catch {
        // Aborted by a newer query; nothing to do.
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, limit]);

  return query.trim().length < MIN_CUSTOMER_QUERY_LENGTH ? [] : results;
}
