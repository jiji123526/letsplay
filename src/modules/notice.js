/* ============================================================
   Notice Module — notice banner, notice input, notice panel
   ============================================================ */

let deps = {};
let currentNotice = "";
let noticeUnsub = null;

/**
 * Initialize notice module with app dependencies.
 */
export function initNotice(config) {
  deps = config;
}

/** Get the current notice text (for external access) */
export function getCurrentNotice() {
  return currentNotice;
}

export function subscribeCurrentNotice() {
  const { getState, subscribeNotice } = deps;
  const { inLiveMode, urlChannel } = getState();

  if (noticeUnsub) noticeUnsub();
  const subscribedChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
  let initialized = false;
  currentNotice = "";
  renderNoticeBanner();
  noticeUnsub = subscribeNotice((text) => {
    if (initialized && text && text !== currentNotice) {
      localStorage.removeItem(`noticeDismissed_${subscribedChannel}`);
    }
    initialized = true;
    currentNotice = text;
    renderNoticeBanner();
  });
}

export function setNoticeBanner(text) {
  const { getState, doSetNotice } = deps;
  const { inLiveMode, urlChannel } = getState();

  currentNotice = text;
  const activeChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
  localStorage.removeItem(`noticeDismissed_${activeChannel}`);
  doSetNotice(text);
  renderNoticeBanner();
}

export function renderNoticeBanner() {
  const { getState } = deps;
  const { inLiveMode, urlChannel } = getState();

  document.querySelector(".notice-banner")?.remove();
  if (!currentNotice) return;
  const activeChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
  if (!inLiveMode && localStorage.getItem(`noticeDismissed_${activeChannel}`) === currentNotice) return;

  let title = currentNotice;
  let body = "";
  try {
    const parsed = JSON.parse(currentNotice);
    if (parsed.title) { title = parsed.title; body = parsed.body || ""; }
  } catch { /* plain text notice */ }

  const bannerEl = document.createElement("div");
  bannerEl.className = "notice-banner";

  let html = `
    <span class="notice-banner-icon"><svg viewBox="0 0 32 32" width="16" height="16" fill="currentColor"><path d="M5.063,19.369l0.521,4.602c0.007,0.067,0.021,0.133,0.042,0.197c0.412,1.266,1.591,2.072,2.855,2.072c0.308,0,0.619-0.048,0.927-0.148c1.572-0.512,2.436-2.208,1.924-3.781l-0.83-2.551h0.261l7.789,3.895c0.142,0.07,0.294,0.105,0.447,0.105c0.183,0,0.365-0.05,0.525-0.149C19.82,23.429,20,23.107,20,22.76v-4.142c1.721-0.447,3-2,3-3.858s-1.279-3.411-3-3.858V6.76c0-0.347-0.18-0.668-0.475-0.851c-0.295-0.183-0.663-0.199-0.973-0.044L10.764,9.76H7c-2.757,0-5,2.243-5,5C2,16.831,3.265,18.611,5.063,19.369z M9.43,22.93c0.171,0.524-0.116,1.089-0.641,1.26c-0.499,0.163-1.032-0.089-1.231-0.562L7.119,19.76h1.279L9.43,22.93z M21,14.76c0,0.737-0.405,1.375-1,1.722v-3.443C20.595,13.385,21,14.023,21,14.76z M18,21.142l-6-3v-6.764l6-3V21.142z M7,11.76h3v6H7c-1.654,0-3-1.346-3-3S5.346,11.76,7,11.76z"/><path d="M27,15.76h2c0.553,0,1-0.448,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.448-1,1S26.447,15.76,27,15.76z"/><path d="M27,10.467c0.256,0,0.512-0.098,0.707-0.293l1.414-1.414c0.391-0.391,0.391-1.023,0-1.414s-1.023-0.391-1.414,0L26.293,8.76c-0.391,0.391-0.391,1.023,0,1.414C26.488,10.37,26.744,10.467,27,10.467z"/><path d="M27.707,22.174c0.195,0.195,0.451,0.293,0.707,0.293s0.512-0.098,0.707-0.293c0.391-0.391,0.391-1.023,0-1.414l-1.414-1.414c-0.391-0.391-1.023-0.391-1.414,0s-0.391,1.023,0,1.414L27.707,22.174z"/></svg></span>
    <span class="notice-banner-title"></span>
  `;

  if (body) {
    html += `<button class="notice-banner-expand">▼</button>`;
  }
  html += `<button class="notice-banner-close">✕</button>`;

  bannerEl.innerHTML = html;
  bannerEl.querySelector(".notice-banner-title").textContent = title;

  if (body) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "notice-banner-body";
    bodyEl.textContent = body;
    bodyEl.style.display = "none";
    bannerEl.appendChild(bodyEl);

    bannerEl.querySelector(".notice-banner-expand").addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = bodyEl.style.display !== "none";
      bodyEl.style.display = isExpanded ? "none" : "block";
      e.target.textContent = isExpanded ? "▼" : "▲";
    });
  }

  bannerEl.querySelector(".notice-banner-close").addEventListener("click", () => {
    const state = deps.getState();
    const ch = state.inLiveMode ? `${state.urlChannel}_live` : state.urlChannel;
    localStorage.setItem(`noticeDismissed_${ch}`, currentNotice);
    bannerEl.remove();
  });

  const liveBannerEl = document.querySelector(".live-exit-banner") || document.querySelector(".live-banner");
  if (liveBannerEl) {
    liveBannerEl.insertAdjacentElement("afterend", bannerEl);
  } else {
    document.querySelector(".chat-header").insertAdjacentElement("afterend", bannerEl);
  }
}

export function showNoticeInput() {
  const { banner } = deps;

  document.querySelector(".notice-edit-dialog")?.remove();

  let currentTitle = "";
  let currentBody = "";
  if (currentNotice) {
    try {
      const parsed = JSON.parse(currentNotice);
      if (parsed.title) { currentTitle = parsed.title; currentBody = parsed.body || ""; }
    } catch { currentTitle = currentNotice; }
  }

  const dialog = document.createElement("div");
  dialog.className = "notice-edit-dialog";
  dialog.innerHTML = `
    <div class="edit-dialog-content">
      <div class="edit-dialog-title">공지 설정</div>
      <input class="notice-edit-title" type="text" placeholder="공지 제목 (비우면 공지 삭제)" />
      <textarea class="edit-dialog-input" rows="4" placeholder="공지 내용 (선택사항)"></textarea>
      <div class="edit-dialog-buttons">
        <button class="edit-dialog-cancel">취소</button>
        <button class="edit-dialog-save">저장</button>
      </div>
    </div>
  `;

  const titleInput = dialog.querySelector(".notice-edit-title");
  const bodyInput = dialog.querySelector(".edit-dialog-input");
  titleInput.value = currentTitle;
  bodyInput.value = currentBody;

  dialog.querySelector(".edit-dialog-save").addEventListener("click", () => {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    dialog.remove();
    if (!title) {
      setNoticeBanner("");
      banner("공지가 삭제되었습니다");
      return;
    }
    const notice = body ? JSON.stringify({ title, body }) : title;
    setNoticeBanner(notice);
  });
  dialog.querySelector(".edit-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });

  document.body.appendChild(dialog);
  titleInput.focus();
}

export function showNoticePanel() {
  const { currentChannelConfig } = deps;

  document.querySelector(".notice-panel")?.remove();

  const sections = currentChannelConfig.notice || [];
  const sectionsHtml = sections.map(s => `
    <div class="notice-section">
      <h4>${s.title}</h4>
      <ul>${s.items.map(i => `<li>${i}</li>`).join("")}</ul>
    </div>
  `).join("");

  const panel = document.createElement("div");
  panel.className = "notice-panel";

  panel.innerHTML = `
    <div class="notice-panel-content">
      <div class="notice-panel-header">
        <h3><svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-2px"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 16v-4M12 8h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> 공지사항</h3>
        <button class="notice-panel-close">✕</button>
      </div>
      <div class="notice-panel-body">
        ${sectionsHtml || '<div style="color:var(--meta);text-align:center;padding:20px">공지사항이 없습니다</div>'}
      </div>
    </div>
  `;

  panel.querySelector(".notice-panel-close").addEventListener("click", () => panel.remove());
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });

  document.body.appendChild(panel);
}
