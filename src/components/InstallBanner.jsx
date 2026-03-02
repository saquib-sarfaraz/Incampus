import { useEffect, useState } from "react";
import { usePWAInstall } from "../hooks/usePWAInstall";

const DISMISS_KEY = "installBannerDismissed";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export default function InstallBanner() {
  const { isInstallable, install } = usePWAInstall();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isInstallable) {
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
  }, [isInstallable]);

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

  if (!isInstallable || !visible) return null;

  return (
    <div className="install-banner" role="dialog" aria-live="polite">
      <div className="install-content">
        <div className="left">
          <img src="/incampus-icon.svg" alt="InCampus" />
          <div>
            <p className="title">Install InCampus</p>
            <p className="subtitle">Faster access - Works offline</p>
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
          <button onClick={handleInstall} className="install-btn" type="button">
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
