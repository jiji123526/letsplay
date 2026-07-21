/* ============================================================
   Admin Panels Module — admin settings UI panels
   ============================================================ */

import { hashString } from "../utils.js";
import { showConfirmDialog, showPromptDialog } from "./dialogs.js";
import { updateEmojiBarPresets } from "./live.js";
import { showSquareCrop } from "./crop.js";

let deps = {};

/**
 * Initialize admin panels with app dependencies.
 * @param {object} config
 */
export function initAdminPanels(config) {
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

export function showAdminPanel() {
  const { urlChannel, currentChannelConfig, IS_MOCK, getState, adminEndLive, broadcastLiveStatus, adminStartLive, enterLiveMode, exitLiveMode, banner, showNoticeInput } = deps;
  const { liveActive, inLiveMode } = getState();

  document.querySelector(".admin-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "admin-panel";

  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>관리자 설정</h3>
        <button class="admin-panel-close">✕</button>
      </div>
      <div class="admin-panel-body">
        <div class="admin-panel-section">
          <button class="admin-panel-item" data-action="category-channel">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg></span>
            <span class="admin-panel-label">채널</span>
            <span class="admin-panel-arrow">›</span>
          </button>
          <button class="admin-panel-item" data-action="category-manage">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
            <span class="admin-panel-label">관리</span>
            <span class="admin-panel-arrow">›</span>
          </button>
          <button class="admin-panel-item" data-action="freeze">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M17 7l-10 10M2 12h20M7 7l10 10"/></svg></span>
            <span class="admin-panel-label">${deps.getState().isFrozen ? "채팅 해제" : "채팅 얼리기"}</span>
            <span class="admin-panel-arrow" style="color:${deps.getState().isFrozen ? "#5B5EA6" : ""}">●</span>
          </button>
          <button class="admin-panel-item admin-panel-live" data-action="live">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93a10 10 0 0 1 14.14 0"/><path d="M7.76 7.76a6 6 0 0 1 8.48 0"/></svg></span>
            <span class="admin-panel-label">${liveActive ? "라이브 종료" : "라이브 시작"}</span>
            <span class="admin-panel-arrow" style="color:${liveActive ? "#e74c3c" : ""}">●</span>
          </button>
        </div>
      </div>
    </div>
  `;

  panel.querySelector(".admin-panel-close").addEventListener("click", () => panel.remove());
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });

  panel.querySelector('[data-action="category-channel"]').addEventListener("click", () => { panel.remove(); showChannelCategory(); });
  panel.querySelector('[data-action="category-manage"]').addEventListener("click", () => { panel.remove(); showManageCategory(); });

  panel.querySelector('[data-action="freeze"]').addEventListener("click", () => {
    panel.remove();
    const currentState = getState();
    if (!currentState.isFrozen) {
      showConfirmDialog("채팅 얼리기", "채팅을 얼리시겠습니까?<br>관리자만 메시지를 보낼 수 있습니다.", () => {
        deps.setFrozen(true);
        banner("채팅이 얼려졌습니다 🧊");
      });
    } else {
      deps.setFrozen(false);
      banner("채팅이 해제되었습니다");
    }
  });

  panel.querySelector('[data-action="live"]').addEventListener("click", async () => {
    panel.remove();
    const currentState = getState();
    if (currentState.liveActive) {
      showConfirmDialog("라이브 종료", "라이브를 종료하시겠습니까?<br>모든 메시지가 삭제됩니다.", async () => {
        if (!IS_MOCK) await adminEndLive(urlChannel);
        if (!IS_MOCK) broadcastLiveStatus(urlChannel);
        deps.setState({ liveActive: false });
        localStorage.setItem(`liveActive_${urlChannel}`, "false");
        localStorage.removeItem(`liveSeen_${urlChannel}`);
        localStorage.removeItem(`liveTitle_${urlChannel}`);
        localStorage.removeItem(`mock_notice_${urlChannel}_live`);
        if (currentState.inLiveMode) {
          localStorage.setItem(`liveEnded_${urlChannel}`, "true");
          exitLiveMode();
        }
      });
    } else {
      showPromptDialog("라이브 시작", "라이브 제목을 입력하세요", async (liveTitle) => {
        let sessionId;
        if (!IS_MOCK) {
          const result = await adminStartLive(urlChannel, liveTitle);
          sessionId = result.sessionId;
          broadcastLiveStatus(urlChannel);
        } else {
          sessionId = crypto.randomUUID();
        }
        deps.setState({ liveActive: true });
        localStorage.setItem(`liveSession_${urlChannel}`, sessionId);
        localStorage.setItem(`liveTitle_${urlChannel}`, liveTitle);
        localStorage.setItem(`liveActive_${urlChannel}`, "true");
        enterLiveMode();
        banner("라이브가 시작되었습니다");
      });
    }
  });

  document.body.appendChild(panel);
}

function showChannelCategory() {
  const { urlChannel, currentChannelConfig, IS_MOCK, banner, showNoticeInput } = deps;

  const panel = document.createElement("div");
  panel.className = "admin-panel";
  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>채널</h3>
        <button class="admin-panel-close">✕</button>
      </div>
      <div class="admin-panel-body">
        <div class="admin-panel-section">
          <button class="admin-panel-item" data-action="profile">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <span class="admin-panel-label">채널 프로필</span>
            <span class="admin-panel-arrow">›</span>
          </button>
          <button class="admin-panel-item" data-action="color">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="8" r="2" fill="currentColor"/><circle cx="8" cy="14" r="2" fill="currentColor"/><circle cx="16" cy="14" r="2" fill="currentColor"/></svg></span>
            <span class="admin-panel-label">채널 기본 색상</span>
            <span class="admin-panel-arrow">›</span>
          </button>
          <button class="admin-panel-item" data-action="passcode">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
            <span class="admin-panel-label">채널 비밀번호</span>
            <span class="admin-panel-arrow">›</span>
          </button>
          <button class="admin-panel-item" data-action="notice">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
            <span class="admin-panel-label">전체 공지</span>
            <span class="admin-panel-arrow">›</span>
          </button>
        </div>
      </div>
    </div>
  `;

  panel.querySelector(".admin-panel-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });
  panel.querySelector('[data-action="profile"]').addEventListener("click", () => { panel.remove(); showProfilePanel(); });
  panel.querySelector('[data-action="color"]').addEventListener("click", () => { panel.remove(); showAdminColorPanel(); });
  panel.querySelector('[data-action="passcode"]').addEventListener("click", () => { panel.remove(); showAdminPasscodePanel(); });
  panel.querySelector('[data-action="notice"]').addEventListener("click", () => { panel.remove(); showNoticeInput(); });

  document.body.appendChild(panel);
}

function showManageCategory() {
  const { urlChannel, IS_MOCK, getState, banner } = deps;

  const panel = document.createElement("div");
  panel.className = "admin-panel";
  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>관리</h3>
        <button class="admin-panel-close">✕</button>
      </div>
      <div class="admin-panel-body">
        <div class="admin-panel-section">
          <button class="admin-panel-item" data-action="banned-words">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18.36 5.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></span>
            <span class="admin-panel-label">금지어</span>
            <span class="admin-panel-arrow">›</span>
          </button>
          <button class="admin-panel-item" data-action="blocked">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg></span>
            <span class="admin-panel-label">차단 사용자</span>
            <span class="admin-panel-arrow">›</span>
          </button>
          <button class="admin-panel-item" data-action="refresh">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg></span>
            <span class="admin-panel-label">전체 새로고침</span>
            <span class="admin-panel-arrow">›</span>
          </button>
        </div>
      </div>
    </div>
  `;

  panel.querySelector(".admin-panel-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });
  panel.querySelector('[data-action="banned-words"]').addEventListener("click", () => { panel.remove(); showBannedWordsPanel(); });
  panel.querySelector('[data-action="blocked"]').addEventListener("click", () => { panel.remove(); showBlockedPanel(); });

  panel.querySelector('[data-action="refresh"]').addEventListener("click", () => {
    panel.remove();
    showConfirmDialog("전체 새로고침", "접속 중인 모든 사용자를 새로고침할까요?", () => {
      deps.broadcastRefresh();
      banner("새로고침 신호를 보냈습니다");
      setTimeout(() => window.location.reload(), 500);
    });
  });

  document.body.appendChild(panel);
}

export function showEmojiPresetPanel() {
  const { urlChannel, getState } = deps;
  const { inLiveMode } = getState();

  document.querySelector(".emoji-preset-panel")?.remove();

  const activeChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
  const currentEmojis = JSON.parse(localStorage.getItem(`liveEmojis_${activeChannel}`) || '["🍋","🔥","❤️","😂","👏","🎉"]');

  const panel = document.createElement("div");
  panel.className = "emoji-preset-panel";
  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>이모지 프리셋</h3>
        <button class="emoji-preset-close">✕</button>
      </div>
      <div class="admin-panel-body admin-body-padded">
        <div class="emoji-preset-list" id="emojiPresetList"></div>
        <div class="banned-words-add">
          <button class="emoji-preset-add-btn">+ 추가</button>
        </div>
        <div class="admin-passcode-result admin-result"></div>
      </div>
    </div>
  `;

  const listEl = panel.querySelector("#emojiPresetList");
  const resultEl = panel.querySelector(".admin-passcode-result");
  let emojis = [...currentEmojis];

  function renderEmojis() {
    listEl.innerHTML = emojis.map((e, i) => `
      <div class="emoji-preset-item" data-idx="${i}" draggable="true">
        <span class="emoji-preset-drag">☰</span>
        <span class="banned-word-text" style="font-size:calc(var(--bubble-font-size, 17px) + 4px)"></span>
        <button class="banned-word-remove" data-idx="${i}">✕</button>
      </div>
    `).join("");
    listEl.querySelectorAll(".emoji-preset-item").forEach((item, i) => {
      item.querySelector(".banned-word-text").textContent = emojis[i];
    });

    let dragIdx = null;
    listEl.querySelectorAll(".emoji-preset-item").forEach(item => {
      item.addEventListener("dragstart", (e) => {
        dragIdx = parseInt(item.dataset.idx);
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      item.addEventListener("dragend", () => { item.classList.remove("dragging"); dragIdx = null; });
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        const overIdx = parseInt(item.dataset.idx);
        if (dragIdx !== null && dragIdx !== overIdx) {
          const [moved] = emojis.splice(dragIdx, 1);
          emojis.splice(overIdx, 0, moved);
          dragIdx = overIdx;
          renderEmojis();
          saveEmojis();
        }
      });
    });

    let touchIdx = null;
    listEl.querySelectorAll(".emoji-preset-item").forEach(item => {
      item.addEventListener("touchstart", () => { touchIdx = parseInt(item.dataset.idx); item.classList.add("dragging"); }, { passive: true });
      item.addEventListener("touchmove", (e) => {
        if (touchIdx === null) return;
        const touch = e.touches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const overItem = el?.closest(".emoji-preset-item");
        if (overItem) {
          const overIdx = parseInt(overItem.dataset.idx);
          if (overIdx !== touchIdx) {
            const [moved] = emojis.splice(touchIdx, 1);
            emojis.splice(overIdx, 0, moved);
            touchIdx = overIdx;
            renderEmojis();
            saveEmojis();
          }
        }
      }, { passive: true });
      item.addEventListener("touchend", () => { item.classList.remove("dragging"); touchIdx = null; });
    });
  }
  renderEmojis();

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".banned-word-remove");
    if (btn) { emojis.splice(parseInt(btn.dataset.idx), 1); renderEmojis(); saveEmojis(); }
  });

  panel.querySelector(".emoji-preset-add-btn").addEventListener("click", () => {
    const pickerWrap = document.createElement("div");
    pickerWrap.className = "emoji-fx-picker-wrap";
    pickerWrap.style.position = "relative";
    pickerWrap.style.bottom = "auto";
    pickerWrap.style.right = "auto";
    pickerWrap.style.marginTop = "12px";
    const picker = document.createElement("emoji-picker");
    pickerWrap.appendChild(picker);
    picker.addEventListener("emoji-click", (e) => {
      const emoji = e.detail.unicode;
      if (!emojis.includes(emoji)) { emojis.push(emoji); renderEmojis(); saveEmojis(); }
    });
    const existing = panel.querySelector(".emoji-fx-picker-wrap");
    if (existing) { existing.remove(); return; }
    panel.querySelector(".banned-words-add").insertAdjacentElement("afterend", pickerWrap);
  });

  function saveEmojis() {
    localStorage.setItem(`liveEmojis_${activeChannel}`, JSON.stringify(emojis));
    resultEl.textContent = "✓ 저장됨";
    resultEl.style.display = "block";
    setTimeout(() => { resultEl.style.display = "none"; }, 1500);
    updateEmojiBarPresets(emojis);
  }

  panel.querySelector(".emoji-preset-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });

  document.body.appendChild(panel);
}

export function showAdminColorPanel() {
  const { urlChannel, currentChannelConfig, IS_MOCK, adminSetColor } = deps;

  document.querySelector(".admin-color-panel")?.remove();

  const currentColor = localStorage.getItem(`bubbleColor_${urlChannel}`) || currentChannelConfig.bubble || "#3b8df0";
  const bubbleColors = ["#3b8df0", "#9b59b6", "#2e7d32", "#e74c3c", "#f39c12", "#1abc9c", "#e91e63"];

  const panel = document.createElement("div");
  panel.className = "admin-color-panel";

  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>채널 기본 색상</h3>
        <button class="admin-color-close">✕</button>
      </div>
      <div class="admin-panel-body admin-body-padded">
        <div class="admin-color-info">이 채널의 기본 말풍선 색상을 설정합니다</div>
        <div class="settings-color-grid" style="width:100%;max-width:200px;margin:16px auto;">
          ${bubbleColors.map(c => `<button class="settings-color-btn ${c === currentColor ? "active" : ""}" data-color="${c}" style="background:${c};${c === currentColor ? `outline-color:${darkenColor(c, 50)}` : ""}"></button>`).join("")}
          <button class="settings-color-btn settings-color-custom ${!bubbleColors.includes(currentColor) ? "active" : ""}" style="background:conic-gradient(red,orange,yellow,green,cyan,blue,violet,red);${!bubbleColors.includes(currentColor) ? `outline-color:${darkenColor(currentColor, 50)}` : ""}">
            <input type="color" class="settings-color-input" value="${currentColor}" />
          </button>
        </div>
      </div>
    </div>
  `;

  panel.querySelector(".admin-color-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });

  panel.querySelectorAll(".settings-color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("settings-color-custom")) return;
      panel.querySelectorAll(".settings-color-btn").forEach(b => { b.classList.remove("active"); b.style.outlineColor = "transparent"; });
      btn.classList.add("active");
      btn.style.outlineColor = darkenColor(btn.dataset.color, 50);
      const color = btn.dataset.color;
      localStorage.setItem(`bubbleColor_${urlChannel}`, color);
      document.documentElement.style.setProperty("--bubble-sent", color);
      if (!IS_MOCK) adminSetColor(urlChannel, color);
    });
  });

  const colorInput = panel.querySelector(".settings-color-input");
  let colorTimer = null;
  colorInput.addEventListener("input", (e) => {
    const color = e.target.value;
    panel.querySelectorAll(".settings-color-btn").forEach(b => { b.classList.remove("active"); b.style.outlineColor = "transparent"; });
    const customBtn = colorInput.closest(".settings-color-custom");
    customBtn.classList.add("active");
    customBtn.style.outlineColor = darkenColor(color, 50);
    localStorage.setItem(`bubbleColor_${urlChannel}`, color);
    document.documentElement.style.setProperty("--bubble-sent", color);
    clearTimeout(colorTimer);
    colorTimer = setTimeout(() => { if (!IS_MOCK) adminSetColor(urlChannel, color); }, 500);
  });

  document.body.appendChild(panel);
}

export function showAdminPasscodePanel() {
  const { urlChannel, currentChannelConfig, IS_MOCK, adminSetPasscode } = deps;

  document.querySelector(".admin-passcode-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "admin-passcode-panel";

  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>채널 비밀번호</h3>
        <button class="admin-passcode-close">✕</button>
      </div>
      <div class="admin-panel-body admin-body-padded">
        <div class="admin-sublabel">현재 채널: ${currentChannelConfig.name}</div>
        <input class="admin-input" type="text" placeholder="새 비밀번호 입력" autocomplete="off" style="margin-bottom:8px;" />
        <div class="admin-sublabel" style="font-size:11px;">비우면 비밀번호 해제</div>
        <button class="admin-passcode-save admin-save-btn">저장</button>
        <div class="admin-passcode-result admin-result"></div>
      </div>
    </div>
  `;

  panel.querySelector(".admin-passcode-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });

  const input = panel.querySelector(".admin-input");
  const resultEl = panel.querySelector(".admin-passcode-result");

  panel.querySelector(".admin-passcode-save").addEventListener("click", async () => {
    const code = input.value.trim();
    if (!code) {
      if (!IS_MOCK) await adminSetPasscode(urlChannel, "");
      resultEl.textContent = "비밀번호가 해제되었습니다";
      resultEl.style.display = "block";
    } else {
      const hashed = await hashString(code);
      if (!IS_MOCK) await adminSetPasscode(urlChannel, hashed);
      resultEl.textContent = "✓ 저장되었습니다";
      resultEl.style.display = "block";
    }
    input.value = "";
    setTimeout(() => { resultEl.style.display = "none"; }, 2000);
  });

  document.body.appendChild(panel);
  input.focus();
}

export function showBannedWordsPanel() {
  const { urlChannel, IS_MOCK, getState } = deps;
  const { inLiveMode } = getState();

  document.querySelector(".banned-words-panel")?.remove();

  const activeChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
  let words = [];
  try {
    const raw = localStorage.getItem(`bannedWords_${activeChannel}`) || "";
    if (raw.startsWith("[")) {
      words = JSON.parse(raw);
    } else if (raw) {
      words = raw.split(",").map(w => ({ word: w.trim(), expires: null })).filter(w => w.word);
    }
  } catch { words = []; }

  const now = Date.now();
  words = words.filter(w => !w.expires || new Date(w.expires).getTime() > now);

  const panel = document.createElement("div");
  panel.className = "banned-words-panel";
  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>금지어</h3>
        <button class="banned-words-close">✕</button>
      </div>
      <div class="admin-panel-body admin-body-padded">
        <div class="banned-words-list" id="bannedWordsList"></div>
        <div class="banned-words-add">
          <input class="banned-words-input" type="text" placeholder="금지어 추가..." />
          <select class="banned-words-duration">
            <option value="">영구</option>
            <option value="1">1일</option>
            <option value="7">7일</option>
            <option value="30">30일</option>
          </select>
          <button class="banned-words-add-btn">+</button>
        </div>
        <div class="admin-passcode-result admin-result"></div>
      </div>
    </div>
  `;

  const listEl = panel.querySelector("#bannedWordsList");
  const inputEl = panel.querySelector(".banned-words-input");
  const durationEl = panel.querySelector(".banned-words-duration");
  const resultEl = panel.querySelector(".admin-passcode-result");

  function formatExpiry(expires) {
    if (!expires) return "영구";
    const diff = new Date(expires).getTime() - Date.now();
    if (diff <= 0) return "만료됨";
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return `${days}일 남음`;
  }

  function renderWords() {
    listEl.innerHTML = words.length === 0
      ? '<div class="admin-empty">등록된 금지어가 없습니다</div>'
      : words.map((w, i) => `
        <div class="banned-word-item">
          <span class="banned-word-text"></span>
          <span class="banned-word-expiry">${formatExpiry(w.expires)}</span>
          <button class="banned-word-remove" data-idx="${i}">✕</button>
        </div>
      `).join("");
    listEl.querySelectorAll(".banned-word-item").forEach((item, i) => {
      item.querySelector(".banned-word-text").textContent = words[i].word;
    });
  }
  renderWords();

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".banned-word-remove");
    if (btn) { words.splice(parseInt(btn.dataset.idx), 1); renderWords(); saveWords(); }
  });

  function addWord() {
    const word = inputEl.value.trim();
    if (!word || words.find(w => w.word === word)) { inputEl.value = ""; return; }
    const days = durationEl.value ? parseInt(durationEl.value) : null;
    const expires = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
    words.push({ word, expires });
    inputEl.value = "";
    renderWords();
    saveWords();
  }

  panel.querySelector(".banned-words-add-btn").addEventListener("click", addWord);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addWord(); }
  });

  async function saveWords() {
    const wordsJson = JSON.stringify(words);
    localStorage.setItem(`bannedWords_${activeChannel}`, wordsJson);
    if (!IS_MOCK) {
      try {
        await fetch("/api/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            passcode: localStorage.getItem("ap") ? atob(localStorage.getItem("ap")) : "",
            action: "setBannedWords",
            payload: { channelId: activeChannel, words: wordsJson }
          }),
        });
      } catch {}
    }
    resultEl.textContent = "✓ 저장됨";
    resultEl.style.display = "block";
    setTimeout(() => { resultEl.style.display = "none"; }, 1500);
  }

  panel.querySelector(".banned-words-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });

  document.body.appendChild(panel);
  inputEl.focus();
}

export function showBlockedPanel() {
  const { blockedUids, blockedList, doUnblock } = deps;

  document.querySelector(".blocked-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "blocked-panel";

  panel.innerHTML = `
    <div class="blocked-panel-content">
      <div class="blocked-panel-header">
        <h3>차단된 사용자</h3>
        <button class="blocked-panel-close">✕</button>
      </div>
      <div class="blocked-panel-list"></div>
    </div>
  `;

  const listEl = panel.querySelector(".blocked-panel-list");
  const currentList = typeof blockedList === "function" ? blockedList() : blockedList;

  if (currentList.length === 0) {
    const empty = document.createElement("div");
    empty.className = "blocked-panel-empty";
    empty.textContent = "차단된 사용자가 없습니다";
    listEl.appendChild(empty);
  } else {
    currentList.forEach((blocked) => {
      const item = document.createElement("div");
      item.className = "blocked-panel-item";
      const info = document.createElement("div");
      info.className = "blocked-panel-info";
      const uid = document.createElement("span");
      uid.className = "blocked-panel-uid";
      uid.textContent = `익명#${String(blocked.uid).slice(-4)}`;
      info.appendChild(uid);
      if (blocked.reason) {
        const reason = document.createElement("span");
        reason.className = "blocked-panel-reason";
        reason.textContent = `"${blocked.reason}"`;
        info.appendChild(reason);
      }
      const button = document.createElement("button");
      button.className = "blocked-panel-unblock";
      button.dataset.uid = blocked.uid;
      button.textContent = "차단 해제";
      item.append(info, button);
      listEl.appendChild(item);
    });
  }

  panel.querySelector(".blocked-panel-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });

  panel.querySelectorAll(".blocked-panel-unblock").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.uid;
      const currentBlockedUids = typeof blockedUids === "function" ? blockedUids() : blockedUids;
      currentBlockedUids.delete(uid);
      await doUnblock(uid);
      panel.remove();
      showBlockedPanel();
    });
  });

  document.body.appendChild(panel);
}

export function showProfilePanel() {
  const { urlChannel, currentChannelConfig, IS_MOCK, banner } = deps;

  document.querySelector(".profile-panel")?.remove();

  const currentName = document.querySelector(".hdr-name")?.textContent || currentChannelConfig.name;
  const currentImg = document.querySelector(".hdr-avatar-img")?.src || currentChannelConfig.profile;

  const panel = document.createElement("div");
  panel.className = "profile-panel";

  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>채널 프로필</h3>
        <button class="profile-panel-close">✕</button>
      </div>
      <div class="admin-panel-body admin-body-padded">
        <div class="profile-upload-wrap">
          <div class="profile-img-preview">
            <img src="${currentImg}" />
          </div>
          <button class="profile-img-btn">사진 변경</button>
          <input type="file" class="profile-img-input" accept="image/*" style="display:none;" />
        </div>
        <div style="margin-bottom:16px;">
          <div class="admin-label">채널 이름</div>
          <input class="profile-name-input admin-input" type="text" value="${currentName}" maxlength="20" />
        </div>
        <button class="profile-save-btn admin-save-btn">저장</button>
        <div class="profile-result admin-result"></div>
      </div>
    </div>
  `;

  panel.querySelector(".profile-panel-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });

  const imgPreview = panel.querySelector(".profile-img-preview img");
  const fileInput = panel.querySelector(".profile-img-input");
  const nameInput = panel.querySelector(".profile-name-input");
  const resultEl = panel.querySelector(".profile-result");
  let croppedBlob = null;

  // click image or button to upload
  panel.querySelector(".profile-img-preview").addEventListener("click", () => fileInput.click());
  panel.querySelector(".profile-img-btn").addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = "";
    showSquareCrop(file, (blob) => {
      croppedBlob = blob;
      imgPreview.src = URL.createObjectURL(blob);
    });
  });

  // save
  panel.querySelector(".profile-save-btn").addEventListener("click", async () => {
    const newName = nameInput.value.trim();
    if (!newName) return;

    const passcode = localStorage.getItem("ap") ? atob(localStorage.getItem("ap")) : "";

    // upload cropped image if changed
    if (croppedBlob && !IS_MOCK) {
      const imageBase64 = await blobToDataUrl(croppedBlob);
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passcode,
          action: "uploadProfile",
          payload: { channelId: urlChannel, imageBase64 }
        }),
      });
      const data = await res.json();
      if (data.url) {
        const hdrImg = document.querySelector(".hdr-avatar-img");
        if (hdrImg) hdrImg.src = data.url;
      }
    } else if (croppedBlob && IS_MOCK) {
      const url = URL.createObjectURL(croppedBlob);
      localStorage.setItem(`mock_profile_${urlChannel}`, url);
      const hdrImg = document.querySelector(".hdr-avatar-img");
      if (hdrImg) hdrImg.src = url;
    }

    // save name
    if (!IS_MOCK) {
      await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passcode,
          action: "setChannelName",
          payload: { channelId: urlChannel, name: newName }
        }),
      });
    } else {
      localStorage.setItem(`mock_channelName_${urlChannel}`, newName);
    }

    // update header immediately
    const hdrName = document.querySelector(".hdr-name");
    if (hdrName) hdrName.textContent = newName;

    // broadcast to other users
    deps.broadcastProfile({ name: newName, image: document.querySelector(".hdr-avatar-img")?.src || null });

    resultEl.textContent = "✓ 저장됨";
    resultEl.style.display = "block";
    setTimeout(() => { resultEl.style.display = "none"; }, 2000);
  });

  document.body.appendChild(panel);
  nameInput.focus();
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
