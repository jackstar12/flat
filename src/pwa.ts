// The authenticated production build is installable; Vite dev stays worker-free.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !window.isSecureContext || !("serviceWorker" in navigator)) return;

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      // Re-registering the same script can reuse its registration without a
      // network check. Explicitly retry updates after connectivity/login returns.
      await registration.update();
    } catch {
      // Offline, expired auth, redirects and non-JS login responses must not break
      // the app or discard a draft. The browser retains a valid existing worker.
      // Retry on the next online event or page entry; never force a login/reload.
    }
  };

  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => void register(), { once: true });
  window.addEventListener("online", () => void register());
}
