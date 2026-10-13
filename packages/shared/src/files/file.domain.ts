// Private files (T-052, M4.1b, A-143, A-144): what may be uploaded, and for what.

/** What a file is for. Each purpose says who may upload it and who may see it. */
export const FILE_PURPOSES = ["service_image", "receipt_proof"] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** The most one upload may weigh. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** How long a signed link to a file stays valid, in seconds. */
export const FILE_LINK_SECONDS = 300;

/**
 * The picture format by its first bytes, never by the name or the type the client claims; null when it is none of the
 * allowed ones.
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const at = (index: number) => bytes[index];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
