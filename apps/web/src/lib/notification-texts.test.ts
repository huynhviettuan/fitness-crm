import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS, NOTIFICATION_TEXTS } from "@flow/shared/notifications";
import en from "../../messages/en.json";
import vi from "../../messages/vi.json";

// The email and the push say what the app says (M6.4): the sentences exist twice, in the messages the app shows and in
// the shared texts the API sends, so this keeps the two from drifting apart.
describe("notification texts", () => {
  it.each([
    ["vi", vi],
    ["en", en],
  ] as const)("the %s sentences the API sends are the ones the app shows", (locale, messages) => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_TEXTS[locale][kind], kind).toBe(messages.notifications.kinds[kind]);
    }
  });
});
