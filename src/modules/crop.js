/* ============================================================
   Square Crop — crop an image to a square before upload
   ============================================================ */

/**
 * Show a square crop overlay for an image file.
 * @param {File|Blob} file - the image file
 * @param {function} onCrop - called with the cropped Blob
 * @param {function} onCancel - called if user cancels
 */
export function showSquareCrop(file, onCrop, onCancel) {
  const overlay = document.createElement("div");
  overlay.className = "crop-overlay";

  const container = document.createElement("div");
  container.className = "crop-container";

  container.innerHTML = `
    <div class="crop-header">프로필 사진 자르기</div>
    <div class="crop-canvas-wrap">
      <canvas class="crop-canvas"></canvas>
      <div class="crop-square"></div>
    </div>
    <div class="crop-buttons">
      <button class="crop-cancel">취소</button>
      <button class="crop-confirm">확인</button>
    </div>
  `;

  overlay.appendChild(container);
  document.body.appendChild(overlay);

  const canvas = container.querySelector(".crop-canvas");
  const ctx = canvas.getContext("2d");
  const cropSquare = container.querySelector(".crop-square");
  const canvasWrap = container.querySelector(".crop-canvas-wrap");

  const img = new Image();
  const url = URL.createObjectURL(file);

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;

  img.onload = () => {
    URL.revokeObjectURL(url);

    const wrapSize = Math.min(window.innerWidth - 48, 320);
    canvasWrap.style.width = `${wrapSize}px`;
    canvasWrap.style.height = `${wrapSize}px`;
    canvas.width = wrapSize;
    canvas.height = wrapSize;

    // fit image so shortest side fills the square
    const imgAspect = img.width / img.height;
    if (imgAspect > 1) {
      scale = wrapSize / img.height;
    } else {
      scale = wrapSize / img.width;
    }
    // center
    offsetX = (wrapSize - img.width * scale) / 2;
    offsetY = (wrapSize - img.height * scale) / 2;

    draw();
  };
  img.src = url;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);
  }

  // drag to pan
  function onPointerDown(e) {
    dragging = true;
    lastX = e.clientX || e.touches?.[0]?.clientX;
    lastY = e.clientY || e.touches?.[0]?.clientY;
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const x = e.clientX || e.touches?.[0]?.clientX;
    const y = e.clientY || e.touches?.[0]?.clientY;
    offsetX += x - lastX;
    offsetY += y - lastY;
    lastX = x;
    lastY = y;
    draw();
  }
  function onPointerUp() { dragging = false; }

  canvas.addEventListener("mousedown", onPointerDown);
  canvas.addEventListener("mousemove", onPointerMove);
  canvas.addEventListener("mouseup", onPointerUp);
  canvas.addEventListener("mouseleave", onPointerUp);
  canvas.addEventListener("touchstart", onPointerDown, { passive: true });
  canvas.addEventListener("touchmove", onPointerMove, { passive: true });
  canvas.addEventListener("touchend", onPointerUp);

  // pinch to zoom
  let lastDist = 0;
  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastDist > 0) {
        const delta = (dist - lastDist) * 0.005;
        const newScale = Math.max(0.5, Math.min(5, scale + delta));
        // zoom toward center
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        offsetX = cx - (cx - offsetX) * (newScale / scale);
        offsetY = cy - (cy - offsetY) * (newScale / scale);
        scale = newScale;
        draw();
      }
      lastDist = dist;
    }
  }, { passive: true });
  canvas.addEventListener("touchend", () => { lastDist = 0; });

  // wheel to zoom (desktop)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.5, Math.min(5, scale + delta));
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    offsetX = cx - (cx - offsetX) * (newScale / scale);
    offsetY = cy - (cy - offsetY) * (newScale / scale);
    scale = newScale;
    draw();
  });

  // confirm: crop the square area from the canvas
  container.querySelector(".crop-confirm").addEventListener("click", () => {
    const outputSize = 512;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = outputSize;
    outCanvas.height = outputSize;
    const outCtx = outCanvas.getContext("2d");
    // draw what's visible on the crop canvas onto the output
    outCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, outputSize, outputSize);
    outCanvas.toBlob((blob) => {
      overlay.remove();
      onCrop(blob);
    }, "image/jpeg", 0.9);
  });

  container.querySelector(".crop-cancel").addEventListener("click", () => {
    overlay.remove();
    if (onCancel) onCancel();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) { overlay.remove(); if (onCancel) onCancel(); }
  });
}
