// Network-only worker. No CacheStorage, private HTML, request queues or telemetry.
// Changing these bytes triggers the browser's normal worker update mechanism.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const offlineDocument = `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f7f8f4"><title>Hugo Wolfgang</title>
<style>body{margin:0;background:#f7f8f4;color:#17201b;font:1rem system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}main{max-width:30rem;padding:2rem}h1{font-size:1.5rem}p{line-height:1.6}a{color:#2f5d50}</style>
</head><body><main><h1>Hugo Wolfgang</h1><p>Du bist offline oder der Server ist nicht erreichbar.</p>
<p>Diese App benötigt Internet und eine gültige Anmeldung. Hier sind keine persönlichen Daten offline verfügbar. Anfragen werden nicht automatisch wiederholt.</p>
<a href="/">Erneut versuchen</a></main></body></html>`;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Only the app entry document has a generic fallback. API, auth, account,
  // receipts, assets and all mutations use the browser's ordinary network path.
  if (request.method !== "GET" || request.mode !== "navigate" ||
      url.origin !== self.location.origin || url.pathname !== "/") return;

  event.respondWith(
    // Pass opaque redirects back to the browser to follow. A failing login
    // destination must never be mistaken for an offline app entry.
    fetch(request, { cache: "no-store", redirect: "manual" }).catch(() => new Response(offlineDocument, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    })),
  );
});
