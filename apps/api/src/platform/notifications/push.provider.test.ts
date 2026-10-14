import { beforeEach, describe, expect, it, vi } from "vitest";

// The Web Push library is the boundary: these tests say how its answers become ours (D-053, D-056).
const sendNotification = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({ default: { sendNotification } }));

const { createWebPushProvider } = await import("./push.provider.js");

const provider = createWebPushProvider({ publicKey: "pub", privateKey: "priv", subject: "mailto:ops@example.test" });
const target = { endpoint: "https://push.example.test/send/1", p256dh: "key", auth: "auth" };
const message = { title: "Việc quá hạn", body: "Gọi khách", url: "/tasks/1" };

beforeEach(() => {
  sendNotification.mockReset();
});

describe("the Web Push provider", () => {
  it("sends the message as JSON, signed with the VAPID key, with a time to live", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });

    expect(await provider.send(target, message)).toEqual({ ok: true });

    const [subscription, payload, options] = sendNotification.mock.calls[0]!;
    expect(subscription).toEqual({ endpoint: target.endpoint, keys: { p256dh: "key", auth: "auth" } });
    expect(JSON.parse(payload)).toEqual(message);
    expect(options).toMatchObject({
      vapidDetails: { subject: "mailto:ops@example.test", publicKey: "pub", privateKey: "priv" },
      TTL: 3600,
    });
  });

  it.each([404, 410])("a %s means the browser dropped the device: delete it, do not retry", async (statusCode) => {
    sendNotification.mockImplementation(() => Promise.reject({ statusCode }));
    expect(await provider.send(target, message)).toEqual({ ok: false, gone: true, retry: false });
  });

  it.each([429, 500, 503])("a %s is worth another try", async (statusCode) => {
    sendNotification.mockImplementation(() => Promise.reject({ statusCode }));
    expect(await provider.send(target, message)).toEqual({ ok: false, gone: false, retry: true });
  });

  it("an unreachable push service is worth another try", async () => {
    sendNotification.mockImplementation(() => Promise.reject(new Error("socket hang up")));
    expect(await provider.send(target, message)).toEqual({ ok: false, gone: false, retry: true });
  });

  it.each([400, 401, 403, 413])("a %s is a refusal that another try will not change", async (statusCode) => {
    sendNotification.mockImplementation(() => Promise.reject({ statusCode }));
    expect(await provider.send(target, message)).toEqual({ ok: false, gone: false, retry: false });
  });
});
