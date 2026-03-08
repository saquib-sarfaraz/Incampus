const INSTALL_READY_EVENT = "incampus-install-ready";
let deferredPrompt = null;
let installReady = false;

const isBrowser = typeof window !== "undefined";

const markInstallReady = () => {
  installReady = true;
  if (!isBrowser) return;
  window.dispatchEvent(new CustomEvent(INSTALL_READY_EVENT));
};

const clearInstallReady = () => {
  installReady = false;
};

if (isBrowser) {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    markInstallReady();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    clearInstallReady();
  });
}

export { INSTALL_READY_EVENT };

export const getDeferredPrompt = () => deferredPrompt;

export const hasDeferredPrompt = () => {
  if (!isBrowser) return false;
  return Boolean(deferredPrompt) || installReady;
};

export const clearDeferredPrompt = () => {
  deferredPrompt = null;
  clearInstallReady();
};
