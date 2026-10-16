// ASCII control characters, except tab, line feed, and carriage return. PostgreSQL
// cannot store NUL at all (a 500 before this check), and the rest have no business
// in names or notes (OWASP A05/A10).
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Zod refinement: use with `{ error: "invalidCharacters" }`. */
export function hasNoControlCharacters(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value);
}

/**
 * Lowercases and strips Vietnamese diacritics so "nguyen van an" matches
 * "Nguyễn Văn An". "đ" has no Unicode decomposition, so it is mapped explicitly.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes spaces, dots, dashes and brackets a user may type in a phone number. */
export function normalizePhone(value: string): string {
  return value.replace(/[\s.\-()]/g, "");
}
