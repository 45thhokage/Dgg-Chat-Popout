// Serves linkers.ooo from the extension's own address so it can be shown in
// the popup.
//
// linkers.ooo sends `Content-Security-Policy: frame-ancestors 'self'`, so
// browsers refuse to show https://linkers.ooo/ inside the popup's iframe.
// Instead the iframe loads chrome-extension://<id>/ and this service worker
// answers every request for a path that isn't one of the extension's own
// files by fetching the same path from https://linkers.ooo and passing the
// response through. This works in every Chromium browser, including Vivaldi,
// where extensions can't see or change the popup's network requests.

const LINKERS_ORIGIN = "https://linkers.ooo";

// The extension's own files. Everything else on this origin is linkers.ooo.
const OWN_FILES = new Set([
  "/index.html",
  "/popup.js",
  "/linkers-shim.js",
  "/sw.js",
  "/manifest.json",
  "/css/popupStyle.css",
  "/icon/icon.png",
  "/icon/dgglogo.png"
]);

// Images and media load fine cross-origin, so send them straight to
// linkers.ooo. Its media proxy redirects to other hosts (Cloudflare storage),
// which a service worker fetch can't follow, and long videos shouldn't be
// streamed through the worker anyway.
const DIRECT_DESTINATIONS = new Set(["image", "video", "audio", "track"]);

// Headers that would block framing or no longer match the decoded body.
const DROP_RESPONSE_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "content-encoding",
  "content-length",
  "transfer-encoding"
];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

// Earlier versions could switch the toolbar button to a window; undo that.
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setPopup({ popup: "index.html" });
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || OWN_FILES.has(url.pathname)) return;
  // linkers' analytics.js asks this whether to load Google Analytics. Say no:
  // extension pages can't load outside scripts, so it would only log a CSP error.
  if (url.pathname === "/api/analytics-config") {
    event.respondWith(Response.json({ gaMeasurementId: null, analyticsEnabled: false }));
    return;
  }
  const target = LINKERS_ORIGIN + url.pathname + url.search;
  if (DIRECT_DESTINATIONS.has(event.request.destination)) {
    event.respondWith(Response.redirect(target, 307));
    return;
  }
  event.respondWith(proxyToLinkers(event.request, target));
});

async function proxyToLinkers(request, target) {
  const isPage = request.mode === "navigate";
  const isHead = request.method === "HEAD";
  const init = {
    method: request.method,
    headers: request.headers,
    credentials: "include",
    // HEAD is only used to check that media exists; its redirect to another
    // host can't be followed here, but the redirect itself means "it exists".
    redirect: isHead ? "manual" : "follow"
  };
  if (request.method !== "GET" && !isHead) {
    init.body = await request.arrayBuffer();
  }

  let res;
  try {
    res = await fetch(target, init);
  } catch (err) {
    return new Response("Could not reach linkers.ooo: " + err.message, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  if (res.type === "opaqueredirect") return new Response(null, { status: 200 });

  // A page that redirected off linkers.ooo (e.g. a login) must not be shown
  // under the extension's address: send the frame to the real URL instead.
  if (isPage && res.redirected && new URL(res.url).origin !== LINKERS_ORIGIN) {
    return Response.redirect(res.url, 302);
  }

  const headers = new Headers(res.headers);
  for (const h of DROP_RESPONSE_HEADERS) headers.delete(h);
  const init2 = { status: res.status, statusText: res.statusText, headers };

  if ([101, 204, 205, 304].includes(res.status) || isHead) {
    return new Response(null, init2);
  }

  // Add the helper script (link handling, embed fixes) to linkers.ooo pages.
  if (isPage && /text\/html/i.test(headers.get("content-type") || "")) {
    const html = await res.text();
    const tag = '<script src="/linkers-shim.js"></script>';
    const withShim = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, m => m + tag)
      : tag + html;
    return new Response(withShim, init2);
  }

  return new Response(res.body, init2);
}
