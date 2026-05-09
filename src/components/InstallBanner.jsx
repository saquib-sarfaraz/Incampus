import { useEffect, useState } from "react";
import {
  INSTALL_READY_EVENT,
  hasDeferredPrompt,
} from "../lib/pwaInstallManager";
import { usePWAInstall } from "../hooks/usePWAInstall";

const DISMISS_KEY = "installBannerDismissed";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const STANDALONE_QUERY = "(display-mode: standalone)";

export default function InstallBanner() {
  const { isInstallable, install, isInstalled } = usePWAInstall();
  const [installReady, setInstallReady] = useState(() =>
    typeof window !== "undefined" ? hasDeferredPrompt() : false
  );
  const [dismissedUntil, setDismissedUntil] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      return Number(localStorage.getItem(DISMISS_KEY) || 0);
    } catch {
      return 0;
    }
  });
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia?.(STANDALONE_QUERY)?.matches ||
      window.navigator?.standalone === true
    );
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mql = window.matchMedia?.(STANDALONE_QUERY);
    const update = () => {
      setIsStandalone(Boolean(mql?.matches || window.navigator?.standalone === true));
    };
    mql?.addEventListener?.("change", update);
    window.addEventListener("appinstalled", update);
    return () => {
      mql?.removeEventListener?.("change", update);
      window.removeEventListener("appinstalled", update);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setInstallReady(true);
    window.addEventListener(INSTALL_READY_EVENT, handler);
    return () => {
      window.removeEventListener(INSTALL_READY_EVENT, handler);
    };
  }, []);

  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const showIOSHelp = isMobile && isIOS && !isStandalone;
  const shouldShowInstall = installReady && isInstallable && !isInstalled;
  const shouldShow = shouldShowInstall || showIOSHelp;
  // eslint-disable-next-line react-hooks/purity
  const isDismissed = dismissedUntil && Date.now() < dismissedUntil;
  const visible = Boolean(shouldShow && !isDismissed);

  const handleDismiss = () => {
    const nextUntil = Date.now() + DISMISS_DURATION_MS;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(
          DISMISS_KEY,
          String(nextUntil)
        );
      } catch {
        // ignore storage errors
      }
    }
    setDismissedUntil(nextUntil);
  };

  const handleInstall = () => {
    install();
  };

  if (!visible) return null;

  return (
    <div className="install-banner" role="dialog" aria-live="polite">
      <div className="install-content">
        <div className="left">
          <img src="/incampus-icon.svg" alt="InCampus" />
          <div>
            <p className="title">Install InCampus</p>
            <p className="subtitle">
              {showIOSHelp
                ? "Tap Share and choose Add to Home Screen"
                : "Get faster access to campus updates, reels, and events."}
            </p>
          </div>
        </div>

        <div className="actions">
          <button
            onClick={handleDismiss}
            className="dismiss"
            type="button"
            aria-label="Dismiss install banner"
          >
            x
          </button>
          {shouldShowInstall && (
            <button onClick={handleInstall} className="install-btn" type="button">
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
