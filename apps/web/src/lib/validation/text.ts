// ASCII control characters, except tab, line feed, and carriage return. PostgreSQL
// cannot store NUL at all (a 500 before this check), and the rest have no business
// in names or notes (OWASP A05/A10).
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Zod refinement: use with `{ error: "invalidCharacters" }`. */
export function hasNoControlCharacters(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value);
}
