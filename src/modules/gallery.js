/* ============================================================
   Gallery View — grid of all shared photos
   ============================================================ */

/**
 * Show the gallery panel.
 * @param {Array} galleryItems - [{ id, image, createdAt }]
 * @param {Array} allMessages - all messages for finding metadata
 * @param {function} onViewImage - (src, meta) called when a photo is tapped
 */
export function showGallery(galleryItems, allMessages, onViewImage) {
  document.querySelector(".gallery-panel")?.remove();

  function galleryDateLabel(d) {
    if (!d) return "날짜 없음";
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}/${String(kst.getUTCMonth()+1).padStart(2,"0")}/${String(kst.getUTCDate()).padStart(2,"0")}`;
  }

  let galleryHtml = "";
  if (galleryItems.length === 0) {
    galleryHtml = '<div class="gallery-empty">사진이 없습니다</div>';
  } else {
    let lastDate = "";
    galleryItems.forEach((g) => {
      const dateLabel = galleryDateLabel(g.createdAt);
      if (dateLabel !== lastDate) {
        lastDate = dateLabel;
        galleryHtml += `<div class="gallery-date-divider">${dateLabel}</div>`;
      }
      galleryHtml += `<img class="gallery-thumb" src="${g.image}" data-id="${g.id}" />`;
    });
  }

  const panel = document.createElement("div");
  panel.className = "gallery-panel";

  panel.innerHTML = `
    <div class="gallery-panel-content">
      <div class="gallery-panel-header">
        <h3><svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-2px"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> 갤러리</h3>
        <button class="gallery-panel-close">✕</button>
      </div>
      <div class="gallery-grid">
        ${galleryHtml}
      </div>
    </div>
  `;

  panel.querySelector(".gallery-panel-close").addEventListener("click", () => panel.remove());
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });

  // tap a photo to view full with metadata
  panel.querySelectorAll(".gallery-thumb").forEach((img) => {
    img.addEventListener("click", () => {
      const galleryId = img.dataset.id;
      const msg = allMessages.find((m) => m.galleryId === galleryId);
      const galleryItem = galleryItems.find((g) => g.id === galleryId);
      const meta = msg
        ? { caption: msg.text || "", date: msg.createdAt, msgId: msg.id }
        : galleryItem
          ? { caption: "", date: galleryItem.createdAt, galleryId: galleryId }
          : null;
      onViewImage(img.src, meta);
    });
  });

  document.body.appendChild(panel);
}
