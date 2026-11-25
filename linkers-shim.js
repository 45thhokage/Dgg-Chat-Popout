// Runs inside the linkers.ooo page shown in the popup (sw.js adds it to every
// linkers.ooo page it serves). It fixes things that break because the page
// lives at the extension's address instead of https://linkers.ooo.
(function () {
  "use strict";

  const LINKERS = "https://linkers.ooo";
  const HERE = location.origin;

  // ---- Links -------------------------------------------------------------
  // Links that would load another site inside the frame (linkers' own
  // absolute links, reddit links, login, ...) get "refused to connect".
  // Keep linkers.ooo pages in the frame; open everything else in a new tab.
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link) return;
    let url;
    try { url = new URL(link.href, location.href); } catch (e) { return; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return; // same-origin or javascript:
    const isLinkers = url.origin === LINKERS;
    if (!isLinkers && link.target === "_blank") return; // already opens a new tab

    event.preventDefault();
    if (isLinkers && !url.pathname.startsWith("/auth/")) {
      location.href = HERE + url.pathname + url.search + url.hash;
      return;
    }
    if (isLinkers) url.searchParams.set("returnTo", LINKERS + "/"); // login / logout
    window.open(url.href, "_blank", "noopener");
  }, true);

  // ---- Embeds ------------------------------------------------------------
  // The popup tells us whether the browser lets the extension add the
  // Referer header YouTube requires (Chrome/Helium yes, Vivaldi popup no).
  let youtubeWorks = null; // null = not known yet
  let check = null;
  try { check = parent !== window ? parent.dggCanFixFrames : null; } catch (e) { /* not in popup */ }
  if (check && typeof check.then === "function") {
    check.then(ok => { youtubeWorks = ok; fixAll(document); });
  } else {
    youtubeWorks = false;
  }

  const YT_SELECTOR = 'iframe[src*="youtube.com/embed/"], iframe[src*="youtube-nocookie.com/embed/"]';

  // Without a Referer, YouTube shows "Error 153": swap in a thumbnail that
  // opens the video on YouTube.
  function youtubeToThumbnail(iframe) {
    const m = /\/embed\/([\w-]{6,})/.exec(iframe.src);
    if (!m) return;
    const id = m[1];
    const a = document.createElement("a");
    a.href = "https://www.youtube.com/watch?v=" + id;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = "Watch on YouTube";
    a.style.cssText = "display:block;position:relative;width:100%;aspect-ratio:16/9;" +
      "background:#000 url('https://i.ytimg.com/vi/" + id + "/hqdefault.jpg') center/cover no-repeat;border-radius:8px;";
    const play = document.createElement("span");
    play.textContent = "▶";
    play.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "width:64px;height:44px;border-radius:12px;background:rgba(255,0,0,.9);color:#fff;" +
      "font-size:22px;line-height:44px;text-align:center;";
    a.appendChild(play);
    iframe.replaceWith(a);
  }

  // linkers uses reddit's widgets.js to turn these cards into embeds, but
  // extension pages can't run outside scripts (it would only log a CSP
  // error), so don't add it and build the embed directly instead.
  const REDDIT_WIDGETS = "https://embed.reddit.com/widgets.js";
  const appendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function (node) {
    if (node instanceof HTMLScriptElement && node.src.startsWith(REDDIT_WIDGETS)) return node;
    return appendChild.call(this, node);
  };

  function redditCardToEmbed(card) {
    const link = card.querySelector("a[href]");
    if (!link) return;
    let url;
    try { url = new URL(link.href); } catch (e) { return; }
    if (!/(^|\.)reddit\.com$/.test(url.hostname)) return;
    const theme = card.getAttribute("data-theme") === "light" ? "light" : "dark";
    const frame = document.createElement("iframe");
    frame.src = "https://embed.reddit.com" + url.pathname + "?embed=true&theme=" + theme +
      "&ref_source=embed&ref=share&embed_host_url=" + encodeURIComponent(LINKERS + "/");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    frame.setAttribute("scrolling", "no");
    frame.height = "320";
    frame.style.cssText = "width:100%;border:none;display:block;border-radius:8px;";
    card.replaceWith(frame);
  }

  // Reddit embeds report their height.
  window.addEventListener("message", event => {
    if (event.origin !== "https://embed.reddit.com" || typeof event.data !== "string") return;
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    if (!msg || msg.type !== "resize.embed") return;
    for (const frame of document.querySelectorAll('iframe[src^="https://embed.reddit.com/"]')) {
      if (frame.contentWindow === event.source) frame.height = String(msg.data);
    }
  });

  function fixAll(root) {
    if (youtubeWorks === false) {
      if (root.matches && root.matches(YT_SELECTOR)) youtubeToThumbnail(root);
      else root.querySelectorAll(YT_SELECTOR).forEach(youtubeToThumbnail);
    }
    if (root.matches && root.matches("blockquote.reddit-card")) redditCardToEmbed(root);
    else root.querySelectorAll("blockquote.reddit-card").forEach(redditCardToEmbed);
  }

  new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) if (node.nodeType === 1) fixAll(node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
