"use client";

import { useEffect, useState } from "react";
import { employeePageSchema, type EmployeeRef } from "@flow/shared/employees";

/** The active employees a form can name, e.g. as a direct manager (D-046); null while loading. */
export function useEmployeeChoices(): EmployeeRef[] | null {
  const [employees, setEmployees] = useState<EmployeeRef[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/v1/employees?status=ACTIVE&pageSize=100", { signal: controller.signal });
        if (response.ok) setEmployees(employeePageSchema.parse(await response.json()).items);
      } catch {
        // Aborted when the form closed; nothing to do.
      }
    })();
    return () => controller.abort();
  }, []);

  return employees;
}
