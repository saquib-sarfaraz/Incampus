import { useEffect, useState } from "react";
import {
  INSTALL_READY_EVENT,
  clearDeferredPrompt,
  getDeferredPrompt,
  hasDeferredPrompt,
} from "../lib/pwaInstallManager";

const isStandaloneMode = () => {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );
};

export function usePWAInstall() {
  const [isInstallable, setIsInstallable] = useState(() => hasDeferredPrompt());
  const [isInstalled, setIsInstalled] = useState(isStandaloneMode());

  useEffect(() => {
    const handleInstallReady = () => {
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      clearDeferredPrompt();
    };

    if (typeof window !== "undefined") {
      setIsInstalled(isStandaloneMode());
      if (hasDeferredPrompt()) setIsInstallable(true);
      window.addEventListener(INSTALL_READY_EVENT, handleInstallReady);
      window.addEventListener("appinstalled", handleAppInstalled);
    }

    return () => {
      if (typeof window === "undefined") return;
      window.removeEventListener(INSTALL_READY_EVENT, handleInstallReady);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const install = async () => {
    const promptEvent = getDeferredPrompt();
    if (!promptEvent) return;
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === "accepted") {
      setIsInstalled(true);
    }
    setIsInstallable(false);
    clearDeferredPrompt();
  };

  return { isInstallable: isInstallable && !isInstalled, install, isInstalled };
}
