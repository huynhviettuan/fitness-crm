// The service worker of the home-screen app (M6.4, D-053, D-056). It does one thing: show a push the server sent and open
// the page it is about. No caching, no offline mode: the CRM is always online, and nothing private is stored here.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only a page of this site can be opened from a push, whatever the message says. */
function pageOf(url) {
  try {
    const target = new URL(url, self.location.origin);
    return target.origin === self.location.origin ? target.href : `${self.location.origin}/notifications`;
  } catch {
    return `${self.location.origin}/notifications`;
  }
}

self.addEventListener("push", (event) => {
  let message = { title: "Demo Gym", body: "", url: "/notifications" };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // A push with no readable body still shows that something happened.
  }
  event.waitUntil(
    self.registration.showNotification(String(message.title).slice(0, 120), {
      body: String(message.body).slice(0, 300),
      icon: "/icons/icon-192.png",
      data: { url: pageOf(message.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = pageOf(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url === url);
      if (open) return open.focus();
      const any = windows[0];
      if (any && "navigate" in any) return any.navigate(url).then((client) => client && client.focus());
      return self.clients.openWindow(url);
    }),
  );
});
