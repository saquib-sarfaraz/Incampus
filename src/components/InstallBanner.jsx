import { useEffect, useState } from "react";
import {
  INSTALL_READY_EVENT,
  hasDeferredPrompt,
} from "../lib/pwaInstallManager";
import { usePWAInstall } from "../hooks/usePWAInstall";

const DISMISS_KEY = "installBannerDismissed";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export default function InstallBanner() {
  const { isInstallable, install, isInstalled } = usePWAInstall();
  const [visible, setVisible] = useState(false);
  const [installReady, setInstallReady] = useState(() =>
    typeof window !== "undefined" ? hasDeferredPrompt() : false
  );
  const [isMobile, setIsMobile] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent || "";
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(ua));
    setIsIOS(/iPhone|iPad|iPod/i.test(ua));
    setIsStandalone(
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
        window.navigator?.standalone === true
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setInstallReady(true);
    window.addEventListener(INSTALL_READY_EVENT, handler);
    return () => {
      window.removeEventListener(INSTALL_READY_EVENT, handler);
    };
  }, []);

  const showIOSHelp = isMobile && isIOS && !isStandalone;
  const shouldShowInstall = installReady && isInstallable && !isInstalled;
  const shouldShow = shouldShowInstall || showIOSHelp;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!shouldShow) {
      setVisible(false);
      return;
    }
    let dismissedUntil = 0;
    try {
      dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) || 0);
    } catch {
      dismissedUntil = 0;
    }
    if (dismissedUntil && Date.now() < dismissedUntil) {
      setVisible(false);
      return;
    }
    setVisible(true);
  }, [shouldShow]);

  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(
          DISMISS_KEY,
          String(Date.now() + DISMISS_DURATION_MS)
        );
      } catch {
        // ignore storage errors
      }
    }
    setVisible(false);
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
                : "Faster access - Works offline"}
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
