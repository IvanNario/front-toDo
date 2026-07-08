import { api } from "./api";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }

  return output;
}

export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function getCurrentPushSubscription() {
  if (!isPushSupported()) return null;

  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPushNotifications() {
  if (!isPushSupported()) {
    throw new Error("Este navegador no soporta notificaciones push.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permiso de notificaciones rechazado.");
  }

  const registration = await navigator.serviceWorker.ready;
  const currentSubscription = await registration.pushManager.getSubscription();

  if (currentSubscription) {
    await api.post("/notifications/subscribe", { subscription: currentSubscription.toJSON() });
    return currentSubscription;
  }

  const { data } = await api.get("/notifications/public-key");
  const publicKey = String(data?.publicKey ?? "");
  if (!publicKey) {
    throw new Error("Falta configurar la clave publica de notificaciones.");
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await api.post("/notifications/subscribe", { subscription: subscription.toJSON() });
  return subscription;
}

export async function unsubscribeFromPushNotifications() {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) return;

  await api.post("/notifications/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

export async function sendTestPushNotification() {
  await api.post("/notifications/test");
}
