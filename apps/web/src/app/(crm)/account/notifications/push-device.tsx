"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellRingIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { subscribePushAction, unsubscribePushAction } from "./actions";

type State = "checking" | "notSetUp" | "unsupported" | "needsInstall" | "denied" | "off" | "on";

/** The base64url key of the push service as the bytes the browser wants. */
function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** Where this device stands: whether it can be pushed to, and whether it is. */
async function detect(publicKey: string): Promise<State> {
  if (!publicKey) return "notSetUp";
  const agent = navigator.userAgent;
  const phone = /iphone|ipad|ipod/i.test(agent);
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // On an iPhone, push works only for an app added to the home screen (iOS 16.4 and later).
  if (phone && !installed) return "needsInstall";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "on" : "off";
}

/** Turns push on or off for this phone or browser (M6.4, D-053, D-056). */
export function PushDevice({ publicKey, devices }: { publicKey: string; devices: number }) {
  const t = useTranslations("staffNotifications.device");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<State>("checking");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    void detect(publicKey).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [publicKey]);

  const turnOn = () =>
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        if ((await Notification.requestPermission()) !== "granted") return setState("denied");
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        });
        const json = subscription.toJSON();
        const result = await subscribePushAction({
          endpoint: json.endpoint ?? subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
        });
        if (!result.ok) return void notify.error(errorMessage(result.code));
        setState("on");
        notify.success(t("turnedOn"));
        router.refresh();
      } catch {
        notify.error(t("failed"));
      }
    });

  const turnOff = () =>
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/sw.js");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await unsubscribePushAction(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setState("off");
        notify.success(t("turnedOff"));
        router.refresh();
      } catch {
        notify.error(t("failed"));
      }
    });

  return (
    <Card role="region" aria-label={t("title")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRingIcon className="size-4" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p data-testid="push-state">{t(`state.${state}`)}</p>
        <p className="text-muted-foreground">{t("devices", { count: devices })}</p>
        {state === "off" && (
          <Button onClick={turnOn} disabled={pending}>
            {t("turnOn")}
          </Button>
        )}
        {state === "on" && (
          <Button variant="outline" onClick={turnOff} disabled={pending}>
            {t("turnOff")}
          </Button>
        )}
        {state === "needsInstall" && <p className="text-muted-foreground">{t("installHint")}</p>}
      </CardContent>
    </Card>
  );
}
