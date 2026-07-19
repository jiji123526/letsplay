/* ============================================================
   Live Mode — temporary opt-in chat
   ============================================================ */

let liveUnsub = null;
let presenceUnsub = null;
let _ctx = null;

/**
 * Initialize live mode with app context.
 * @param {object} ctx - { getState, setState, subscribe, setChannel, initBroadcast, subscribeCurrentNotice, subscribeCurrentGallery, subscribeCurrentDm, render, debouncedRender, banner, adminEndLive, IS_MOCK }
 *   getState() returns { urlChannel, isAdmin, liveActive, inLiveMode, allMessages, messages, dmMessages, hasScrolledInitial }
 *   setState(updates) merges into app state
 */
export function initLiveMode(ctx) {
  _ctx = ctx;
}

export function enterLiveMode() {
  const { urlChannel, isAdmin } = _ctx.getState();
  _ctx.setState({ inLiveMode: true, allMessages: [], messages: [], dmMessages: [], hasScrolledInitial: false });
  localStorage.setItem(`inLiveMode_${urlChannel}`, "true");
  _ctx.setChannel(`${urlChannel}_live`);
  _ctx.initBroadcast();
  _ctx.subscribeCurrentNotice();
  _ctx.subscribeCurrentGallery();
  _ctx.subscribeCurrentDm();
  _ctx.render();
  // subscribe to live channel messages
  liveUnsub = _ctx.subscribe((list) => {
    const { isAdmin, dmMessages } = _ctx.getState();
    const messages = isAdmin
      ? [...list, ...dmMessages.map(d => ({ ...d, dm: true }))].sort((a,b) => (a.createdAt||0)-(b.createdAt||0))
      : list.filter(m => !m.report);
    _ctx.setState({ allMessages: list, messages });
    _ctx.debouncedRender();
  });
  document.querySelector(".chat-header").classList.add("live-active");
  showLiveExitBanner();
  startLivePresence();
  showEmojiBar();
}

function startLivePresence() {
  const { urlChannel } = _ctx.getState();
  const sessionId = localStorage.getItem(`liveSession_${urlChannel}`) || "legacy-active";
  if (presenceUnsub) presenceUnsub();
  presenceUnsub = _ctx.subscribeLivePresence(`${urlChannel}-${sessionId}`, (count) => {
    const counter = document.querySelector(".live-viewer-count");
    if (counter) counter.textContent = String(count);
  });
}

export function refreshLivePresence() {
  if (!_ctx?.getState().inLiveMode) return;
  startLivePresence();
}

export function showLiveExitBanner() {
  const { urlChannel, isAdmin, IS_MOCK } = _ctx.getState();
  const liveTitle = localStorage.getItem(`liveTitle_${urlChannel}`) || "라이브";
  document.querySelector(".live-exit-banner")?.remove();
  document.querySelector(".live-viewer-badge")?.remove();
  const bannerEl = document.createElement("div");
  bannerEl.className = "live-exit-banner";
  bannerEl.innerHTML = `
    <span class="live-banner-dot">●</span>
    <span class="live-banner-text"></span>
    <button class="live-exit-btn">${isAdmin ? "종료" : "나가기"}</button>
  `;
  bannerEl.querySelector(".live-banner-text").textContent = `라이브 채팅 참여중: ${liveTitle}`;
  bannerEl.querySelector(".live-exit-btn").addEventListener("click", async () => {
    if (isAdmin) {
      _ctx.showConfirmDialog("라이브 종료", "라이브를 종료하시겠습니까?<br>모든 메시지가 삭제됩니다.", async () => {
        if (!IS_MOCK) await _ctx.adminEndLive(urlChannel);
        if (!IS_MOCK) _ctx.broadcastLiveStatus(urlChannel);
        _ctx.setState({ liveActive: false });
        localStorage.setItem(`liveActive_${urlChannel}`, "false");
        localStorage.removeItem(`liveSeen_${urlChannel}`);
        localStorage.removeItem(`mock_notice_${urlChannel}_live`);
        localStorage.setItem(`liveEnded_${urlChannel}`, "true");
        exitLiveMode();
      });
    } else {
      exitLiveMode();
    }
  });
  document.querySelector(".chat-header").insertAdjacentElement("afterend", bannerEl);
  const viewerBadge = document.createElement("div");
  viewerBadge.className = "live-viewer-badge";
  viewerBadge.setAttribute("aria-label", "라이브 참여 인원");
  viewerBadge.innerHTML = `
    <svg class="live-viewer-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.25"></circle>
      <path d="M5.75 19c.45-4 2.55-6 6.25-6s5.8 2 6.25 6"></path>
    </svg>
    <span class="live-viewer-count" aria-live="polite">0</span>
  `;
  bannerEl.appendChild(viewerBadge);
}

export function exitLiveMode() {
  const { urlChannel } = _ctx.getState();
  _ctx.setState({ inLiveMode: false });
  localStorage.setItem(`inLiveMode_${urlChannel}`, "false");
  if (liveUnsub) { liveUnsub(); liveUnsub = null; }
  if (presenceUnsub) { presenceUnsub(); presenceUnsub = null; }
  document.querySelector(".live-viewer-badge")?.remove();
  _ctx.setChannel(urlChannel);
  _ctx.initBroadcast();
  _ctx.subscribeCurrentNotice();
  _ctx.setState({ allMessages: [], messages: [], hasScrolledInitial: false });
  _ctx.render();
  window.location.reload();
}

export function showLivePopup() {
  const { urlChannel } = _ctx.getState();
  document.querySelector(".live-popup")?.remove();
  const sessionId = localStorage.getItem(`liveSession_${urlChannel}`) || "legacy-active";
  localStorage.setItem(`liveSeen_${urlChannel}`, sessionId);

  const liveTitle = localStorage.getItem(`liveTitle_${urlChannel}`) || "라이브 채팅";
  const popup = document.createElement("div");
  popup.className = "live-popup";
  popup.innerHTML = `
    <div class="live-popup-content">
      <div class="live-popup-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93a10 10 0 0 1 14.14 0"/><path d="M7.76 7.76a6 6 0 0 1 8.48 0"/></svg></div>
      <div class="live-popup-title"></div>
      <div class="live-popup-desc">라이브 채팅이 시작되었습니다.<br>참여하시겠습니까?<br>라이브 종료 시 모든 메시지가 삭제됩니다.</div>
      <div class="live-popup-buttons">
        <button class="live-popup-no">안할래</button>
        <button class="live-popup-yes">참여</button>
      </div>
    </div>
  `;
  popup.querySelector(".live-popup-title").textContent = liveTitle;

  popup.querySelector(".live-popup-no").addEventListener("click", () => { popup.remove(); showLiveBanner(); });
  popup.querySelector(".live-popup-yes").addEventListener("click", () => {
    popup.remove();
    enterLiveMode();
  });
  popup.addEventListener("click", (e) => { if (e.target === popup) popup.remove(); });

  document.body.appendChild(popup);
}

export function showLiveBanner() {
  const { liveActive, inLiveMode, urlChannel } = _ctx.getState();
  document.querySelector(".live-banner")?.remove();
  if (!liveActive || inLiveMode) return;

  const liveTitle = localStorage.getItem(`liveTitle_${urlChannel}`) || "라이브 진행 중";
  const bannerEl = document.createElement("div");
  bannerEl.className = "live-banner";
  bannerEl.innerHTML = `
    <span class="live-banner-dot">●</span>
    <span class="live-banner-text"></span>
    <button class="live-banner-join">참여</button>
  `;
  bannerEl.querySelector(".live-banner-text").textContent = `라이브 채팅 진행중: ${liveTitle}`;

  bannerEl.querySelector(".live-banner-join").addEventListener("click", () => {
    bannerEl.remove();
    enterLiveMode();
  });

  document.querySelector(".chat-header").insertAdjacentElement("afterend", bannerEl);
}

export function removeLiveBanner() {
  document.querySelector(".live-banner")?.remove();
}

export function showLiveEndedPopup() {
  const popup = document.createElement("div");
  popup.className = "live-popup live-ended-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-modal", "true");
  popup.tabIndex = -1;
  popup.innerHTML = `
    <div class="live-popup-content">
      <div class="live-popup-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93a10 10 0 0 1 14.14 0"/><path d="M7.76 7.76a6 6 0 0 1 8.48 0"/></svg></div>
      <div class="live-popup-title">라이브 종료</div>
      <div class="live-popup-desc">라이브 채팅이 종료되었습니다.</div>
      <div class="live-popup-buttons">
        <button class="live-popup-yes" style="background:#666;">확인</button>
      </div>
    </div>
  `;

  const close = () => {
    document.removeEventListener("keydown", close);
    popup.remove();
  };
  popup.addEventListener("click", close);
  document.addEventListener("keydown", close);

  document.body.appendChild(popup);
  popup.focus();
}


/* ============================================================
   Emoji Effects — live mode only
   ============================================================ */
const PRESET_EMOJIS = ["🍋", "🔥", "❤️", "😂", "👏", "🎉"];

function getPresetEmojis() {
  const { urlChannel } = _ctx.getState();
  const activeChannel = `${urlChannel}_live`;
  try {
    const stored = localStorage.getItem(`liveEmojis_${activeChannel}`);
    if (stored) return JSON.parse(stored);
  } catch {}
  return PRESET_EMOJIS;
}

export function updateEmojiBarPresets(emojis) {
  // update trigger to show first emoji
  const trigger = document.querySelector(".emoji-fx-trigger");
  if (trigger && emojis.length > 0) trigger.textContent = emojis[0];
  // re-render the emoji grid if it's open
  const grid = document.querySelector(".emoji-fx-grid");
  if (grid) {
    grid.remove();
    toggleEmojiGrid();
  }
}

export function showEmojiBar() {
  removeEmojiBar();
  requestAnimationFrame(() => {
    const inputWrap = document.querySelector(".input-wrap");
    if (!inputWrap || document.querySelector(".emoji-fx-trigger")) return;
    
    const trigger = document.createElement("button");
    trigger.className = "emoji-fx-trigger";
    trigger.textContent = getPresetEmojis()[0] || "🎉";
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleEmojiGrid();
    });
    // insert before the send button
    const sendBtn = inputWrap.querySelector("#sendBtn");
    if (sendBtn) sendBtn.insertAdjacentElement("beforebegin", trigger);
    else inputWrap.appendChild(trigger);
  });
}

function removeEmojiBar() {
  document.querySelector(".emoji-fx-trigger")?.remove();
  document.querySelector(".emoji-fx-grid")?.remove();
  document.querySelector(".emoji-fx-picker-wrap")?.remove();
}

function toggleEmojiGrid() {
  const existing = document.querySelector(".emoji-fx-grid");
  if (existing) { existing.remove(); return; }

  const grid = document.createElement("div");
  grid.className = "emoji-fx-grid";
  grid.innerHTML = `
    <div class="emoji-fx-grid-inner">
      ${getPresetEmojis().map(e => `<button class="emoji-fx-btn">${e}</button>`).join("")}
      <button class="emoji-fx-btn emoji-fx-more">+</button>
    </div>
  `;

  grid.querySelectorAll(".emoji-fx-btn:not(.emoji-fx-more)").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      triggerEmoji(btn.textContent);
    });
  });

  grid.querySelector(".emoji-fx-more").addEventListener("click", (e) => {
    e.stopPropagation();
    grid.remove();
    toggleFullEmojiPicker();
  });

  // close on outside click
  function closeGrid(e) {
    if (!grid.contains(e.target) && !e.target.closest(".emoji-fx-trigger")) {
      grid.remove();
      document.removeEventListener("click", closeGrid);
    }
  }
  setTimeout(() => document.addEventListener("click", closeGrid), 10);

  document.body.appendChild(grid);
}

function toggleFullEmojiPicker() {
  const existing = document.querySelector(".emoji-fx-picker-wrap");
  if (existing) { existing.remove(); return; }

  const wrap = document.createElement("div");
  wrap.className = "emoji-fx-picker-wrap";
  const picker = document.createElement("emoji-picker");
  wrap.appendChild(picker);

  picker.addEventListener("emoji-click", (e) => {
    triggerEmoji(e.detail.unicode);
  });

  function outsideClick(e) {
    if (!wrap.contains(e.target) && !e.target.closest(".emoji-fx-trigger")) {
      wrap.remove();
      document.removeEventListener("click", outsideClick);
    }
  }
  setTimeout(() => document.addEventListener("click", outsideClick), 10);

  document.body.appendChild(wrap);
}

function triggerEmoji(emoji) {
  const x = 30 + Math.random() * 40;
  const h = 65 + Math.random() * 25;
  spawnEmoji(emoji, x, h);
  if (_ctx.broadcastEmoji) _ctx.broadcastEmoji(emoji, x, h);
}

export function spawnEmoji(emoji, x, h) {
  const id = `efx_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const el = document.createElement("div");
  el.className = "emoji-fx";
  el.textContent = emoji;
  el.style.left = `${x}%`;
  el.style.setProperty("--fly-h", `${h}vh`);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// also export removeEmojiBar for exitLiveMode
export { removeEmojiBar };
