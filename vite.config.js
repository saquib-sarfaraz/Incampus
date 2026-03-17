import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const isValidEnvValue = (value) => {
  if (!value) return false;
  const raw = String(value).trim();
  if (!raw) return false;
  if (raw.startsWith("REPLACE_WITH")) return false;
  return true;
};

const assertFirebaseEnv = (mode) => {
  if (mode !== "production") return;
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const required = [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID",
    "VITE_FIREBASE_VAPID_KEY",
  ];
  const missing = required.filter((key) => !isValidEnvValue(env[key]));
  if (missing.length) {
    throw new Error(
      `Missing required Firebase env vars for FCM: ${missing.join(", ")}`
    );
  }
};

export default defineConfig(({ mode }) => {
  assertFirebaseEnv(mode);
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
          secure: false,
        },
        "/socket.io": {
          target: "http://localhost:8000",
          ws: true,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            reactVendor: ["react", "react-dom"],
            router: ["react-router-dom"],
            motion: ["framer-motion"],
            query: ["@tanstack/react-query"],
          },
        },
      },
    },
    esbuild:
      mode === "production"
        ? {
            drop: ["console", "debugger"],
          }
        : undefined,
  };
});
