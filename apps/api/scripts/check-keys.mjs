/* global console, process, Buffer */
// Before the trial's migrations (A-314, docs/34 step 2): the keys Render generated must have the lengths the API needs.
// The API would refuse them too, but only after the migrations ran; this says which key and how to replace it, never its value.
const BYTES_32 = ["FIELD_ENCRYPTION_KEY", "BACKUP_ENCRYPTION_KEY"];

const problems = [];
for (const name of BYTES_32) {
  const value = process.env[name];
  if (value && Buffer.from(value, "base64").length !== 32) problems.push(`${name} does not decode to 32 bytes`);
}
if ((process.env.BETTER_AUTH_SECRET ?? "").length < 32)
  problems.push("BETTER_AUTH_SECRET is shorter than 32 characters");

if (problems.length > 0) {
  for (const problem of problems) console.error(`Key check: ${problem}.`);
  console.error(
    "Fix: Render → gymcrm-api → Environment → replace that value with the output of `openssl rand -base64 32` " +
      "(or `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"`), then save. " +
      "Replace FIELD_ENCRYPTION_KEY only before any ID number or health note is stored (docs/34).",
  );
  process.exit(1);
}
console.info("Key check: ok");
