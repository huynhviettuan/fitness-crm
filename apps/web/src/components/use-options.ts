"use client";

import { useEffect, useState } from "react";
import { optionListSchema, type Option, type OptionListKey } from "@gymcrm/shared/options";

/**
 * The active options of a list (D-016), in admin's order with "Khác" last, fetched
 * from the API when a form opens so a change shows at once. Null while loading.
 */
export function useOptions(listKey: OptionListKey | null): Option[] | null {
  const [loaded, setLoaded] = useState<{ listKey: OptionListKey; options: Option[] } | null>(null);

  useEffect(() => {
    if (!listKey) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/v1/option-lists/${listKey}/options`, { signal: controller.signal });
        if (response.ok) setLoaded({ listKey, options: optionListSchema.parse(await response.json()).items });
      } catch {
        // Aborted when the form closed or the list changed; nothing to do.
      }
    })();
    return () => controller.abort();
  }, [listKey]);

  return loaded && loaded.listKey === listKey ? loaded.options : null;
}
