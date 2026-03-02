/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");
importScripts("/firebase-config.js");

const firebaseConfig =
  self.__FIREBASE_CONFIG__ || {
    apiKey: "REPLACE_WITH_FIREBASE_API_KEY",
    authDomain: "REPLACE_WITH_FIREBASE_AUTH_DOMAIN",
    projectId: "REPLACE_WITH_FIREBASE_PROJECT_ID",
    storageBucket: "REPLACE_WITH_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "REPLACE_WITH_FIREBASE_MESSAGING_SENDER_ID",
    appId: "REPLACE_WITH_FIREBASE_APP_ID",
    measurementId: "REPLACE_WITH_FIREBASE_MEASUREMENT_ID",
  };

const isValidValue = (value) => {
  if (!value) return false;
  const raw = String(value);
  return raw && !raw.startsWith("REPLACE_WITH");
};
const hasConfig =
  isValidValue(firebaseConfig.apiKey) &&
  isValidValue(firebaseConfig.projectId) &&
  isValidValue(firebaseConfig.messagingSenderId);

if (hasConfig) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const notification = payload?.notification || {};
    const data = payload?.data || {};
    const title = notification.title || data.title || "New notification";
    const body = notification.body || data.body || "";
    const route = data.route || "/";

    self.registration.showNotification(title, {
      body,
      data: { route },
      icon: "/favicon.ico",
      badge: "/favicon.ico",
    });
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = event.notification?.data?.route || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(route);
          return client.focus();
        }
      }
      return clients.openWindow(route);
    })
  );
});
