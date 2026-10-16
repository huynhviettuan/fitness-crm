"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ImageIcon, ImagePlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { useValidationMessage } from "@/components/form-fields";
import type { ActionResult } from "@/lib/actions/result";
import { MAX_FILE_BYTES, type FilePurpose } from "@gymcrm/shared/files";
import { apiErrorSchema } from "@gymcrm/shared/errors";
import { fileLinkSchema } from "@gymcrm/shared/files";

// Private pictures (T-052, M4.1b): the bytes are never at a public address. The browser asks the API for a link that
// is signed for this user and expires in minutes, then shows the picture from it.

/** Shows a stored picture through a fresh signed link. */
export function SignedImage({ fileId, alt, className }: { fileId: string; alt: string; className?: string }) {
  const t = useTranslations("files");
  // The answer for one file; a different file is loading until its own answer arrives.
  const [answer, setAnswer] = useState<{ fileId: string; src: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/files/${fileId}/link`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body) => !cancelled && setAnswer({ fileId, src: fileLinkSchema.parse(body).url }))
      .catch(() => !cancelled && setAnswer({ fileId, src: null }));
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const current = answer?.fileId === fileId ? answer : null;
  const src = current?.src ?? null;
  if (current && !src) return <p className="text-sm text-muted-foreground">{t("unavailable")}</p>;
  if (!src) return <div className={`animate-pulse rounded-md bg-muted ${className ?? "h-40 w-full"}`} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- a signed, expiring address on our own origin
  return <img src={src} alt={alt} className={className ?? "max-h-80 rounded-md border object-contain"} />;
}

type PictureManagerProps = {
  purpose: FilePurpose;
  /** The picture now attached, if any. */
  fileId: string | null;
  alt: string;
  /** Whether the user may add, replace, or remove it. */
  canChange: boolean;
  /** Attaches the uploaded file (or null to remove): a Server Action that calls the API. */
  attach: (fileId: string | null) => Promise<ActionResult>;
};

/** The picture of a record with upload, replace, and remove: the upload goes to the API, then the record is told. */
export function PictureManager({ purpose, fileId, alt, canChange, attach }: PictureManagerProps) {
  const t = useTranslations("files");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const validationMessage = useValidationMessage();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const change = (next: string | null, message: string) =>
    startTransition(async () => {
      const result = await attach(next);
      if (!result.ok) return void notify.error(errorMessage(result.code));
      notify.success(message);
      router.refresh();
    });

  const upload = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) return void notify.error(validationMessage("fileTooLarge"));
    const response = await fetch(`/api/v1/files?purpose=${purpose}`, {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
      const reason = parsed.success ? parsed.data.details.fieldErrors?.file?.[0] : undefined;
      return void notify.error(
        reason ? validationMessage(reason) : errorMessage(parsed.success ? parsed.data.code : "INTERNAL_ERROR"),
      );
    }
    change(((await response.json()) as { id: string }).id, t("saved"));
  };

  return (
    <div className="space-y-3">
      {fileId ? (
        <SignedImage fileId={fileId} alt={alt} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ImageIcon className="size-4" />
          {t("none")}
        </p>
      )}
      {canChange && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label={t("choose")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) startTransition(() => upload(file));
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>
            <ImagePlusIcon />
            {fileId ? t("replace") : t("choose")}
          </Button>
          {fileId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => change(null, t("removed"))}
            >
              <Trash2Icon />
              {t("remove")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
