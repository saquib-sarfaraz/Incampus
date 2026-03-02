import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";
import "./index.css";

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let debug = false;
    try {
      debug =
        import.meta.env.DEV || localStorage.getItem("incampus:debug:sw") === "1";
    } catch {
      debug = import.meta.env.DEV;
    }
    navigator.serviceWorker
      .register("/firebase-messaging-sw.js")
      .then((reg) => {
        if (debug) console.log("[sw] registered", reg);
      })
      .catch((err) => {
        if (debug) console.log("[sw] register error", err);
      });
  });
}

if (import.meta.env.PROD && typeof window !== "undefined") {
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { isDisabled: true };
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
