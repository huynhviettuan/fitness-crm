import { z } from "zod";
import { AppError } from "@/lib/errors/app-error";

/**
 * Parses external input at the server boundary. Invalid input becomes a
 * VALIDATION_FAILED error whose field errors hold i18n keys from `validation.*`.
 */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors = z.flattenError(result.error).fieldErrors as Record<string, string[]>;
    throw new AppError("VALIDATION_FAILED", { fieldErrors });
  }
  return result.data;
}
