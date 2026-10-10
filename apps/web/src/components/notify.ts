"use client";

import { toast } from "sonner";

/** The only way to show a toast (docs/23 §8). Messages are already translated. */
export const notify = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
};
