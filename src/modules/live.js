/* ============================================================
   Live Mode — temporary opt-in chat
   ============================================================ */

let liveUnsub = null;
let _ctx = null;

/**
 * Initialize live mode with app context.
 * @param {object} ctx - { getState, setState, subscribe, setChannel, render, debouncedRender, banner, adminEndLive, IS_MOCK }
 *   getState() returns { urlChannel, isAdmin, liveActive, inLiveMode, allMessages, messages, dmMessages, hasScrolledInitial }
 *   setState(updates) merges into app state
 */
export function initLiveMode(ctx) {
  _ctx = ctx;
}

export function enterLiveMode() {
  const { urlChannel, isAdmin } = _ctx.getState();
  _ctx.setState({ inLiveMode: true, allMessages: [], messages: [], hasScrolledInitial: false });
  localStorage.setItem(`inLiveMode_${urlChannel}`, "true");
  _ctx.setChannel(`${urlChannel}_live`);
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
  // subscribe to live channel notice
  if (_ctx.subscribeNotice) {
    _ctx.subscribeNotice(_ctx.onNotice);
  }
  showLiveExitBanner();
}

export function showLiveExitBanner() {
  const { urlChannel, isAdmin, IS_MOCK } = _ctx.getState();
  const liveTitle = localStorage.getItem(`liveTitle_${urlChannel}`) || "라이브";
  document.querySelector(".live-exit-banner")?.remove();
  const bannerEl = document.createElement("div");
  bannerEl.className = "live-exit-banner";
  bannerEl.innerHTML = `
    <span class="live-banner-dot">●</span>
    <span class="live-banner-text">라이브 채팅 참여중: ${liveTitle}</span>
    <button class="live-exit-btn">${isAdmin ? "종료" : "나가기"}</button>
  `;
  bannerEl.querySelector(".live-exit-btn").addEventListener("click", async () => {
    if (isAdmin) {
      if (!confirm("라이브를 종료하시겠습니까?")) return;
      if (!IS_MOCK) await _ctx.adminEndLive(urlChannel);
      _ctx.setState({ liveActive: false });
      localStorage.setItem(`liveActive_${urlChannel}`, "false");
      localStorage.removeItem(`liveSeen_${urlChannel}`);
      localStorage.removeItem(`mock_notice_${urlChannel}_live`);
      localStorage.setItem(`liveEnded_${urlChannel}`, "true");
      exitLiveMode();
    } else {
      exitLiveMode();
    }
  });
  document.querySelector(".chat-header").insertAdjacentElement("afterend", bannerEl);
}

export function exitLiveMode() {
  const { urlChannel } = _ctx.getState();
  _ctx.setState({ inLiveMode: false });
  localStorage.setItem(`inLiveMode_${urlChannel}`, "false");
  if (liveUnsub) { liveUnsub(); liveUnsub = null; }
  _ctx.setChannel(urlChannel);
  _ctx.setState({ allMessages: [], messages: [], hasScrolledInitial: false });
  _ctx.render();
  window.location.reload();
}

export function showLivePopup() {
  const { urlChannel } = _ctx.getState();
  document.querySelector(".live-popup")?.remove();
  localStorage.setItem(`liveSeen_${urlChannel}`, "true");

  const liveTitle = localStorage.getItem(`liveTitle_${urlChannel}`) || "라이브 채팅";
  const popup = document.createElement("div");
  popup.className = "live-popup";
  popup.innerHTML = `
    <div class="live-popup-content">
      <div class="live-popup-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93a10 10 0 0 1 14.14 0"/><path d="M7.76 7.76a6 6 0 0 1 8.48 0"/></svg></div>
      <div class="live-popup-title">${liveTitle}</div>
      <div class="live-popup-desc">라이브 채팅이 시작되었습니다.<br>참여하시겠습니까?<br>라이브 종료 시 모든 메시지가 삭제됩니다.</div>
      <div class="live-popup-buttons">
        <button class="live-popup-no">안할래</button>
        <button class="live-popup-yes">참여</button>
      </div>
    </div>
  `;

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
    <span class="live-banner-text">라이브 채팅 진행중: ${liveTitle}</span>
    <button class="live-banner-join">참여</button>
  `;

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
  popup.className = "live-popup";
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

  popup.querySelector(".live-popup-yes").addEventListener("click", () => popup.remove());
  popup.addEventListener("click", (e) => { if (e.target === popup) popup.remove(); });

  document.body.appendChild(popup);
}
