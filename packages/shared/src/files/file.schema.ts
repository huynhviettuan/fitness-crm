import { z } from "zod";
import { instant } from "../validation/index.js";
import { FILE_PURPOSES, IMAGE_TYPES } from "./file.domain.js";

export const uploadQuerySchema = z.object({ purpose: z.enum(FILE_PURPOSES, { error: "invalidChoice" }) });

/** Attaching an uploaded file to a record, or taking it off with null. */
export const attachFileSchema = z.object({ fileId: z.uuid({ error: "invalidChoice" }).nullable() });

export const storedFileSchema = z
  .object({
    id: z.uuid(),
    purpose: z.enum(FILE_PURPOSES),
    contentType: z.enum(IMAGE_TYPES),
    size: z.int(),
    createdAt: instant,
  })
  .meta({ id: "StoredFile" });

/** A signed link to a file's bytes: it expires, and it works only for the signed-in user it was made for. */
export const fileLinkSchema = z.object({ url: z.string(), expiresAt: instant }).meta({ id: "FileLink" });

export type StoredFileView = z.output<typeof storedFileSchema>;
export type FileLink = z.output<typeof fileLinkSchema>;
