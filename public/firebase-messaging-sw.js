/* eslint-disable no-undef */
let firebaseCompatLoaded = false;
try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");
  firebaseCompatLoaded = true;
} catch (error) {
  void error;
  // If Firebase scripts fail to load (network blocks, offline, etc),
  // keep the SW installable so PWA install prompts still work.
  firebaseCompatLoaded = false;
}

// Static Firebase web config (service workers can't read `import.meta.env`).
// These values are safe to be public; they identify the Firebase project.
const firebaseConfig = {
  apiKey: "AIzaSyB-X2g6indGmu7slQM5dTMl78OfCn-GI6I",
  authDomain: "incampus-online.firebaseapp.com",
  projectId: "incampus-online",
  storageBucket: "incampus-online.firebasestorage.app",
  messagingSenderId: "375765136817",
  appId: "1:375765136817:web:b6e38c03fadbe601e7b990",
  measurementId: "G-HGJ4DM4HTM",
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

if (firebaseCompatLoaded && hasConfig && typeof firebase !== "undefined") {
  try {
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
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
      });
    });
  } catch (error) {
    void error;
    // Silent: SW still works for installability + notification click routing.
  }
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

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
