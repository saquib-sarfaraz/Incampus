import { initializeApp, getApps } from "firebase/app";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "",
};

const hasFirebaseConfig = () => {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.messagingSenderId &&
      firebaseConfig.appId
  );
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
