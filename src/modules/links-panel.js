/* ============================================================
   Links Panel — shows all shared links with OG previews
   ============================================================ */

/**
 * Show the links panel.
 * @param {Array} allMessages - all messages to extract URLs from
 * @param {function} onNavigate - called with msgId when a link card is clicked
 */
export function showLinks(allMessages, onNavigate) {
  document.querySelector(".links-panel")?.remove();

  const urlRegex = /(https?:\/\/[^\s]+|(?:www\.|(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|dev|app|co|me|tv|gg|xyz|kr|jp))[^\s]*)/g;
  const links = [];
  allMessages.forEach((m) => {
    if (m.text) {
      const matches = m.text.match(urlRegex);
      if (matches) {
        matches.forEach((url) => {
          const fullUrl = url.startsWith("http") ? url : `https://${url}`;
          links.push({ url: fullUrl, date: m.createdAt, msgId: m.id });
        });
      }
    }
  });

  // deduplicate by URL, keep most recent
  const seen = new Map();
  links.forEach((l) => { if (!seen.has(l.url)) seen.set(l.url, l); });
  const uniqueLinks = [...seen.values()].reverse();

  const panel = document.createElement("div");
  panel.className = "links-panel";

  panel.innerHTML = `
    <div class="links-panel-content">
      <div class="links-panel-header">
        <h3><svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-2px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> 링크</h3>
        <button class="links-panel-close">✕</button>
      </div>
      <div class="links-list" id="linksList">
        ${uniqueLinks.length === 0 ? '<div class="links-empty">공유된 링크가 없습니다</div>' : '<div class="links-loading">로딩 중...</div>'}
      </div>
    </div>
  `;

  panel.querySelector(".links-panel-close").addEventListener("click", () => panel.remove());
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });

  document.body.appendChild(panel);

  // fetch previews for each link
  if (uniqueLinks.length > 0) {
    const listEl = panel.querySelector("#linksList");
    listEl.innerHTML = "";
    uniqueLinks.forEach(async (link) => {
      const card = document.createElement("div");
      card.className = "links-card";
      card.style.cursor = "pointer";
      const urlEl = document.createElement("div");
      urlEl.className = "links-card-url";
      urlEl.textContent = link.url;
      card.appendChild(urlEl);
      card.addEventListener("click", () => {
        panel.remove();
        onNavigate(link.msgId);
      });
      listEl.appendChild(card);

      // try to fetch preview
      try {
        const res = await fetch(`/api/preview?url=${encodeURIComponent(link.url)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.title || data.image) {
            card.replaceChildren();
            if (data.image) {
              const image = document.createElement("img");
              image.className = "links-card-img";
              image.src = data.image;
              card.appendChild(image);
            }
            const body = document.createElement("div");
            body.className = "links-card-body";
            if (data.siteName) {
              const site = document.createElement("div");
              site.className = "links-card-site";
              site.textContent = data.siteName;
              body.appendChild(site);
            }
            if (data.title) {
              const title = document.createElement("div");
              title.className = "links-card-title";
              title.textContent = data.title;
              body.appendChild(title);
            }
            card.appendChild(body);
          }
        }
      } catch (e) { /* keep URL fallback */ }
    });
  }
}
