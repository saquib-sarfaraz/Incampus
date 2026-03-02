import { getToken, onMessage } from "firebase/messaging";
import { getFirebaseMessaging, getFirebaseVapidKey } from "./firebase";
import { registerPushToken } from "../services/api";

const SW_PATH = "/firebase-messaging-sw.js";
let initialized = false;
let lastUserId = "";

const shouldDebug = () => {
  if (typeof window === "undefined") return false;
  try {
    return (
      import.meta.env.DEV ||
      localStorage.getItem("incampus:debug:push") === "1"
    );
  } catch {
    return import.meta.env.DEV;
  }
};

const debugLog = (...args) => {
  if (!shouldDebug()) return;
  console.log("[push]", ...args);
};

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) return null;
  try {
    debugLog("registering service worker", SW_PATH);
    const registration = await navigator.serviceWorker.register(SW_PATH);
    debugLog("service worker registered", registration);
    return registration;
  } catch {
    debugLog("service worker registration failed");
    return null;
  }
};

export const initPushNotifications = async ({ currentUser }) => {
  if (!currentUser?.id) return;
  const userId = String(currentUser.id);
  if (initialized && lastUserId === userId) return;

  debugLog("init push notifications", userId);
  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    debugLog("messaging not available or unsupported");
    return;
  }

  const swRegistration = await registerServiceWorker();
  const permission = await Notification.requestPermission();
  debugLog("notification permission", permission);
  if (permission !== "granted") return;

  try {
    const envKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";
    const vapidKey = getFirebaseVapidKey() || envKey;
    if (!vapidKey) {
      debugLog("missing VAPID key");
    }
    const token = await getToken(messaging, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: swRegistration || undefined,
    });
    debugLog("fcm token", token);
    if (token) {
      await registerPushToken(token);
    }
  } catch {
    debugLog("failed to get FCM token");
    // Silent fail to avoid blocking UX.
  }

  onMessage(messaging, (payload) => {
    window.dispatchEvent(new CustomEvent("fcm:message", { detail: payload }));
  });

  initialized = true;
  lastUserId = userId;
};
