/* ============================================================
   Link Previews & Native Embeds (Twitter, Instagram)
   ============================================================ */

const previewCache = {};

export function embedTwitter(url, bubble) {
  const tweetId = url.match(/status\/(\d+)/)?.[1];
  if (!tweetId) return;

  // hide the link text
  const link = bubble.querySelector(`.bubble-link[href="${url}"]`) || bubble.querySelector(`.bubble-link`);
  if (link) link.style.display = "none";

  const container = document.createElement("div");
  container.className = "embed-twitter";
  container.style.minHeight = "80px";
  bubble.appendChild(container);

  // load Twitter widget script if not already loaded
  function renderTweet() {
    if (window.twttr?.widgets?.createTweet) {
      window.twttr.widgets.createTweet(tweetId, container, {
        theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        conversation: "none",
        width: 320,
      });
    }
  }

  if (window.twttr?.widgets) {
    renderTweet();
  } else {
    if (!document.getElementById("twitter-wjs")) {
      const script = document.createElement("script");
      script.id = "twitter-wjs";
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      document.body.appendChild(script);
    }
    (window.twttr = window.twttr || { _e: [] })._e.push(renderTweet);
  }
}

export function embedInstagram(url, bubble) {
  // hide the link text
  const link = bubble.querySelector(`.bubble-link[href="${url}"]`) || bubble.querySelector(`.bubble-link`);
  if (link) link.style.display = "none";

  const container = document.createElement("div");
  container.className = "embed-instagram";
  container.style.maxWidth = "320px";
  container.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14" style="max-width:320px;width:100%;margin:0;border:0;border-radius:12px;background:#f4f4f4;"></blockquote>`;
  bubble.appendChild(container);

  // load Instagram embed script if not already loaded
  function processEmbeds() {
    if (window.instgrm?.Embeds?.process) {
      window.instgrm.Embeds.process();
    }
  }

  if (window.instgrm) {
    processEmbeds();
  } else if (!document.getElementById("insta-embed-js")) {
    const script = document.createElement("script");
    script.id = "insta-embed-js";
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    script.onload = processEmbeds;
    document.body.appendChild(script);
  } else {
    setTimeout(processEmbeds, 1000);
  }
}

export async function fetchLinkPreview(url, bubble) {
  if (previewCache[url]) {
    renderPreviewCard(previewCache[url], bubble);
    return;
  }

  try {
    const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.title && !data.image) return;
    previewCache[url] = data;
    renderPreviewCard(data, bubble);
  } catch (e) {
    // silently fail — no preview
  }
}

function renderPreviewCard(data, bubble) {
  const card = document.createElement("a");
  card.className = "link-preview-card";
  card.href = data.url;
  card.target = "_blank";
  card.rel = "noopener";

  let html = "";
  if (data.video) {
    html += `<video class="link-preview-video" src="${data.video}" poster="${data.image || ""}" controls playsinline preload="metadata"></video>`;
    card.addEventListener("click", (e) => {
      if (e.target.tagName === "VIDEO") e.preventDefault();
    });
  } else if (data.image) {
    html += `<img class="link-preview-img" src="${data.image}" alt="" />`;
  }
  html += `<div class="link-preview-body">`;
  if (data.siteName) html += `<div class="link-preview-site">${data.siteName}</div>`;
  if (data.title) html += `<div class="link-preview-title">${data.title}</div>`;
  if (data.description) html += `<div class="link-preview-desc">${data.description.slice(0, 100)}${data.description.length > 100 ? "…" : ""}</div>`;
  html += `</div>`;

  card.innerHTML = html;

  // hide the specific link that this preview replaces
  bubble.querySelectorAll(".bubble-link").forEach((link) => {
    if (link.href === data.url || link.textContent === data.url) {
      link.style.display = "none";
    }
  });

  bubble.appendChild(card);
}
