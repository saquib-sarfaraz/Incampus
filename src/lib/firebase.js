import { initializeApp, getApps } from "firebase/app";
import { getMessaging, isSupported } from "firebase/messaging";

const isValidValue = (value) => {
  if (!value) return false;
  const raw = String(value).trim();
  if (!raw) return false;
  if (raw.startsWith("REPLACE_WITH")) return false;
  return true;
};

const buildEnvConfig = () => ({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "",
  vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || "",
});

const resolveRuntimeConfig = () => {
  if (typeof window === "undefined") return null;
  return window.__FIREBASE_CONFIG__ || null;
};

const resolveConfig = () => {
  const runtime = resolveRuntimeConfig();
  if (
    runtime &&
    isValidValue(runtime.apiKey) &&
    isValidValue(runtime.projectId) &&
    isValidValue(runtime.messagingSenderId) &&
    isValidValue(runtime.appId)
  ) {
    return runtime;
  }
  return buildEnvConfig();
};

const firebaseConfig = resolveConfig();

const hasFirebaseConfig = () => {
  return Boolean(
    isValidValue(firebaseConfig.apiKey) &&
      isValidValue(firebaseConfig.projectId) &&
      isValidValue(firebaseConfig.messagingSenderId) &&
      isValidValue(firebaseConfig.appId)
  );
};

export const getFirebaseVapidKey = () => {
  return isValidValue(firebaseConfig.vapidKey) ? firebaseConfig.vapidKey : "";
};

export const getFirebaseApp = () => {
  if (!hasFirebaseConfig()) return null;
  if (getApps().length) return getApps()[0];
  return initializeApp(firebaseConfig);
};

export const getFirebaseMessaging = async () => {
  if (!hasFirebaseConfig()) return null;
  const supported = await isSupported();
  if (!supported) return null;
  const app = getFirebaseApp();
  if (!app) return null;
  return getMessaging(app);
};
