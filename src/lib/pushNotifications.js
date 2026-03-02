import { getToken, onMessage } from "firebase/messaging";
import { getFirebaseMessaging, getFirebaseVapidKey } from "./firebase";
import { registerPushToken } from "../services/api";

const SW_PATH = "/firebase-messaging-sw.js";
let initialized = false;
let lastUserId = "";

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH);
  } catch {
    return null;
  }
};

export const initPushNotifications = async ({ currentUser }) => {
  if (!currentUser?.id) return;
  const userId = String(currentUser.id);
  if (initialized && lastUserId === userId) return;

  const messaging = await getFirebaseMessaging();
  if (!messaging) return;

  const swRegistration = await registerServiceWorker();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  try {
    const envKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";
    const vapidKey = getFirebaseVapidKey() || envKey;
    const token = await getToken(messaging, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: swRegistration || undefined,
    });
    if (token) {
      await registerPushToken(token);
    }
  } catch {
    // Silent fail to avoid blocking UX.
  }

  onMessage(messaging, (payload) => {
    window.dispatchEvent(new CustomEvent("fcm:message", { detail: payload }));
  });

  initialized = true;
  lastUserId = userId;
};
