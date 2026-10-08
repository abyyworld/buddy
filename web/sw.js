// Buddy's service worker: only shows content-free notifications. No caching, so your chat never sits
// on the phone outside the page itself, and every launch loads the latest app from your Mac.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || "Buddy", {
      body: d.body || "Buddy sent you a message", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
      tag: "buddy", renotify: true, data: { url: "/phone" } }),
    self.navigator.setAppBadge ? self.navigator.setAppBadge(1).catch(() => {}) : null,
  ]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => ["/phone", "/", "/chat.html"].includes(new URL(c.url).pathname.replace(/(.)\/$/, "$1")));
    return open ? open.focus() : self.clients.openWindow("/phone");
  }));
});
