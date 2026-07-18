/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

type PushPayload = {
  title?: string;
  body?: string;
  icon?: string;
  tag?: string;
  url?: string;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener("push", (event) => {
  const payload: PushPayload = event.data?.json() ?? {};
  const title = payload.title || "Organize";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "Tienes tareas pendientes por revisar.",
      icon: payload.icon || "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag || "organize-reminder",
      data: {
        url: payload.url || "/dashboard",
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url.startsWith(self.location.origin)) {
          void client.focus();
          if ("navigate" in client) return client.navigate(targetUrl);
          return client;
        }
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
