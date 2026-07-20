/* ============================================================
   Settings Module — header menu + settings panel
   ============================================================ */

let deps = {};

/**
 * Initialize settings module with app dependencies.
 */
export function initSettings(config) {
  deps = config;
}

/** Helper: darken a hex color */
function darkenColor(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}

export function showHeaderMenu(e) {
  const { isAdmin, showGallery, showLinks, showAdminPanel } = deps;

  document.querySelector(".header-menu")?.remove();

  const menu = document.createElement("div");
  menu.className = "header-menu";
  menu.innerHTML = `
    <button class="header-menu-item" data-action="settings"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="2"/></svg> 설정</button>
    <button class="header-menu-item" data-action="gallery"><svg viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> 갤러리</button>
    <button class="header-menu-item" data-action="links"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> 링크</button>
    ${isAdmin ? '<button class="header-menu-item header-menu-admin" data-action="admin"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill="none" stroke="currentColor" stroke-width="2"/></svg> 관리자 설정</button>' : ''}
  `;

  menu.querySelector('[data-action="settings"]').addEventListener("click", () => { menu.remove(); showSettingsPanel(); });
  menu.querySelector('[data-action="gallery"]').addEventListener("click", () => { menu.remove(); showGallery(); });
  menu.querySelector('[data-action="links"]').addEventListener("click", () => { menu.remove(); showLinks(); });
  if (isAdmin) menu.querySelector('[data-action="admin"]')?.addEventListener("click", () => { menu.remove(); showAdminPanel(); });

  const rect = document.querySelector(".hdr-menu").getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(menu);

  setTimeout(() => {
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", close); } };
    document.addEventListener("click", close);
  }, 10);
}

export function showSettingsPanel() {
  const { urlChannel, currentChannelConfig, isAdmin, IS_MOCK, adminSetColor } = deps;

  document.querySelector(".settings-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "settings-panel";

  const currentSize = parseInt(localStorage.getItem("fontSize") || "17");
  const currentColor = localStorage.getItem(`bubbleColor_${urlChannel}`) || currentChannelConfig.bubble || "#3b8df0";
  const bubbleColors = ["#3b8df0", "#9b59b6", "#2e7d32", "#e74c3c", "#f39c12", "#1abc9c", "#e91e63"];

  panel.innerHTML = `
    <div class="settings-panel-content">
      <div class="settings-panel-header">
        <h3>설정</h3>
        <button class="settings-panel-close">✕</button>
      </div>
      <div class="settings-panel-body">
        <div class="settings-item">
          <span class="settings-label">글자 크기</span>
          <div class="settings-font-control">
            <button class="settings-font-btn" data-dir="-1">A-</button>
            <span class="settings-font-value" id="fontSizeValue">${currentSize}px</span>
            <button class="settings-font-btn" data-dir="1">A+</button>
          </div>
        </div>
        <div class="settings-item">
          <span class="settings-label">말풍선 색상</span>
          <div class="settings-color-grid">
            ${bubbleColors.map(c => `<button class="settings-color-btn ${c === currentColor ? "active" : ""}" data-color="${c}" style="background:${c};${c === currentColor ? `outline-color:${darkenColor(c, 50)}` : ""}"></button>`).join("")}
            <button class="settings-color-btn settings-color-custom ${!bubbleColors.includes(currentColor) ? "active" : ""}" style="background:conic-gradient(red,orange,yellow,green,cyan,blue,violet,red);${!bubbleColors.includes(currentColor) ? `outline-color:${darkenColor(currentColor, 50)}` : ""}">
              <input type="color" class="settings-color-input" value="${currentColor}" />
            </button>
          </div>
        </div>
        <div class="settings-divider"></div>
      </div>
    </div>
  `;

  panel.querySelector(".settings-panel-close").addEventListener("click", () => panel.remove());
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });

  // font size controls
  panel.querySelectorAll(".settings-font-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = parseInt(btn.dataset.dir);
      const current = parseInt(panel.querySelector("#fontSizeValue").textContent);
      const newSize = Math.min(20, Math.max(12, current + dir));
      localStorage.setItem("fontSize", newSize);
      document.documentElement.style.setProperty("--bubble-font-size", `${newSize}px`);
      panel.querySelector("#fontSizeValue").textContent = `${newSize}px`;
    });
  });

  // bubble color controls
  panel.querySelectorAll(".settings-color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("settings-color-custom")) return;
      panel.querySelectorAll(".settings-color-btn").forEach(b => { b.classList.remove("active"); b.style.outlineColor = "transparent"; });
      btn.classList.add("active");
      btn.style.outlineColor = darkenColor(btn.dataset.color, 50);
      const color = btn.dataset.color;
      localStorage.setItem(`bubbleColor_${urlChannel}`, color);
      document.documentElement.style.setProperty("--bubble-sent", color);
      if (isAdmin && !IS_MOCK) adminSetColor(urlChannel, color);
    });
  });

  // custom color picker
  const colorInput = panel.querySelector(".settings-color-input");
  let colorSaveTimer = null;
  colorInput.addEventListener("input", (e) => {
    const color = e.target.value;
    panel.querySelectorAll(".settings-color-btn").forEach(b => { b.classList.remove("active"); b.style.outlineColor = "transparent"; });
    const customBtn = colorInput.closest(".settings-color-custom");
    customBtn.classList.add("active");
    customBtn.style.outlineColor = darkenColor(color, 50);
    localStorage.setItem(`bubbleColor_${urlChannel}`, color);
    document.documentElement.style.setProperty("--bubble-sent", color);
    if (isAdmin && !IS_MOCK) {
      clearTimeout(colorSaveTimer);
      colorSaveTimer = setTimeout(() => adminSetColor(urlChannel, color), 500);
    }
  });

  document.body.appendChild(panel);
}
