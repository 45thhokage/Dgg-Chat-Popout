// Page script for the popup (index.html).

// Does this browser let the extension see (and so adjust) requests made by
// the popup's frames? Chrome/Helium: yes. Vivaldi hides them. Checked on the
// dgg chat frame; linkers-shim.js reads the answer to decide how to show
// YouTube videos.
window.dggCanFixFrames = new Promise(resolve => {
  let done = false;
  const finish = value => {
    if (done) return;
    done = true;
    chrome.webRequest.onBeforeRequest.removeListener(listener);
    resolve(value);
  };
  const listener = details => {
    if (details.initiator === location.origin) finish(true);
  };
  chrome.webRequest.onBeforeRequest.addListener(listener, {
    urls: ["https://www.destiny.gg/embed/chat*"],
    types: ["sub_frame"]
  });
  document.addEventListener("DOMContentLoaded", () => {
    const chat = document.getElementById("chatIframe");
    chat.addEventListener("load", () => setTimeout(() => finish(false), 500), { once: true });
  });
  setTimeout(() => finish(false), 10000);
});

// YouTube refuses to play embeds without a Referer ("Error 153"), and pages
// at a chrome-extension:// address don't send one. Add it for YouTube frames
// inside this extension's pages (only works where the browser allows it).
async function addYouTubeReferer() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "referer", operation: "set", value: "https://linkers.ooo/" }]
      },
      condition: {
        requestDomains: ["youtube.com", "youtube-nocookie.com"],
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["sub_frame"]
      }
    }]
  });
}

async function loadFrames() {
  try {
    await addYouTubeReferer();
  } catch (err) {
    console.error("Could not add YouTube referer rule:", err);
  }
  // Chat is loaded from here (not the HTML) so the check above is listening first.
  const chat = document.getElementById("chatIframe");
  chat.src = chat.dataset.src;

  // linkers.ooo is served at the extension's own address by sw.js; make sure
  // that worker is running first, or the frame shows "file not found".
  try {
    await navigator.serviceWorker.ready;
  } catch (err) {
    console.error("Service worker not ready:", err);
  }
  document.getElementById("linkersIframe").src = chrome.runtime.getURL("/");
}

// The old wss://linkers.ooo/_/live.destiny.gg feed no longer exists,
// so read stream status straight from destiny.gg.
async function updateLiveHeader() {
  const head = document.getElementsByClassName("onlineHeader")[0];
  try {
    const res = await fetch("https://www.destiny.gg/api/info/stream", { cache: "no-store" });
    const json = await res.json();
    const streams = (json.data && json.data.streams) || {};
    const live = Object.values(streams).some(s => s && s.live === true);
    head.style.visibility = live ? "visible" : "hidden";
  } catch (err) {
    console.error("Could not get stream status:", err);
    head.style.visibility = "hidden";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadFrames();
  updateLiveHeader();
  setInterval(updateLiveHeader, 60000);
});
