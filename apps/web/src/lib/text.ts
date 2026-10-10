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
