/* ============================================================
   Photo utilities — compression, full-image viewer
   ============================================================ */

/**
 * Compress an image file to a JPEG Blob with max width and quality.
 * GIFs should skip this to preserve animation.
 * Returns { blob, width, height }
 */
export function compressImage(file, maxWidth, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = (maxWidth / w) * h; w = maxWidth; }
      w = Math.round(w);
      h = Math.round(h);
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve({ blob, width: w, height: h }), "image/jpeg", quality);
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Get dimensions of a File (for GIFs or images that skip compression).
 * Returns { width, height }
 */
export function getImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Show a full-screen image overlay with optional caption and date navigation.
 * @param {string} src - image URL
 * @param {object} [meta] - { caption, date, msgId }
 * @param {function} [onNavigate] - called with msgId when date is clicked
 */
export function showFullImage(src, meta, onNavigate) {
  const overlay = document.createElement("div");
  overlay.className = "img-overlay";
  const img = document.createElement("img");
  img.src = src;
  overlay.appendChild(img);

  if (meta) {
    const info = document.createElement("div");
    info.className = "img-overlay-info";
    if (meta.caption) {
      const caption = document.createElement("div");
      caption.className = "img-overlay-caption";
      caption.textContent = meta.caption;
      info.appendChild(caption);
    }
    if (meta.date) {
      const d = new Date(meta.date);
      const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
      const dateButton = document.createElement("button");
      dateButton.className = "img-overlay-date";
      dateButton.textContent = `${dateStr} →`;
      info.appendChild(dateButton);
    }
    overlay.appendChild(info);

    const dateBtn = info.querySelector(".img-overlay-date");
    if (dateBtn && (meta.msgId || meta.galleryId) && onNavigate) {
      dateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        overlay.remove();
        document.querySelector(".gallery-panel")?.remove();
        onNavigate(meta.msgId || meta.galleryId, !!meta.galleryId);
      });
    }
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}
