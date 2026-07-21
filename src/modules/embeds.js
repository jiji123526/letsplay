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

export function embedYouTube(url, bubble) {
  // extract video ID from various YouTube URL formats
  const match = url.match(/(?:[?&]v=|youtu\.be\/|shorts\/)([\w-]+)/);
  const videoId = match?.[1];
  if (!videoId) return;

  // hide the link text
  const link = bubble.querySelector(`.bubble-link[href="${url}"]`) || bubble.querySelector(`.bubble-link`);
  if (link) link.style.display = "none";

  const isShorts = url.includes("/shorts/");
  const container = document.createElement("div");
  container.className = "embed-youtube";
  container.style.borderRadius = "12px";
  container.style.overflow = "hidden";
  container.style.maxWidth = "320px";
  container.style.background = "#000";

  const iframe = document.createElement("iframe");
  iframe.width = "320";
  iframe.height = isShorts ? "568" : "180";
  iframe.src = `https://www.youtube.com/embed/${videoId}`;
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
  iframe.allowFullscreen = true;
  iframe.style.display = "block";
  iframe.style.maxWidth = "100%";
  iframe.style.border = "0";

  container.appendChild(iframe);
  bubble.appendChild(container);
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

  if (data.video) {
    const video = document.createElement("video");
    video.className = "link-preview-video";
    video.src = data.video;
    video.poster = data.image || "";
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    card.appendChild(video);
    card.addEventListener("click", (e) => {
      if (e.target.tagName === "VIDEO") e.preventDefault();
    });
  } else if (data.image) {
    const image = document.createElement("img");
    image.className = "link-preview-img";
    image.src = data.image;
    image.alt = "";
    card.appendChild(image);
  }
  const body = document.createElement("div");
  body.className = "link-preview-body";
  const addText = (className, value) => {
    if (!value) return;
    const element = document.createElement("div");
    element.className = className;
    element.textContent = value;
    body.appendChild(element);
  };
  addText("link-preview-site", data.siteName);
  addText("link-preview-title", data.title);
  if (data.description) addText("link-preview-desc", `${data.description.slice(0, 100)}${data.description.length > 100 ? "…" : ""}`);
  card.appendChild(body);

  // hide the specific link that this preview replaces
  bubble.querySelectorAll(".bubble-link").forEach((link) => {
    if (link.href === data.url || link.textContent === data.url) {
      link.style.display = "none";
    }
  });

  bubble.appendChild(card);
}
