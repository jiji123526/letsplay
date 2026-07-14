/* ============================================================
   iMessage UI  —  realtime chat (backend-agnostic)
   ------------------------------------------------------------
   This file is pure UI/UX. It talks only to ./backend.js, which
   is either the local mock (localStorage, no Firebase) or real
   Firebase — controlled by USE_MOCK in firebase-config.js.

   Message object: { id, uid, nick, text, is_admin, createdAt:Date }
   Renders blue "sent" when uid === my uid, else gray "recv".
   ============================================================ */

import { initAuth, subscribe, sendMessage, removeMessage, softDeleteMessage, editMessage, addReaction as addReactionBackend, removeReaction as removeReactionBackend, blockUser, getBlockedUsers, subscribeBlocked, IS_MOCK } from "./backend.js";
import { ADMIN_PASSCODE } from "./firebase-config.js";
import "https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js";

const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages");

/* ---------- local state ---------- */
let myUid   = null;
let myNick  = "";          // derived from uid on sign-in (anonymous tag)
let isAdmin = false;
let messages = [];               // filtered list for rendering
let allMessages = [];            // unfiltered list for lookups
let reportedMsgIds = new Set(JSON.parse(localStorage.getItem("reportedMsgIds") || "[]"));

function saveReportedIds() {
  localStorage.setItem("reportedMsgIds", JSON.stringify([...reportedMsgIds]));
}

/* ============================================================
   RENDERING  (your original iMessage logic, driven by live data)
   ============================================================ */
function render() {
  // check if user is near the bottom before re-rendering
  const shouldAutoScroll = messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 50;

  messagesEl.innerHTML = "";

  // separate top-level messages, replies, and reports
  const topLevel = [];
  const repliesMap = {}; // parentId -> [reply messages]

  messages.forEach((m) => {
    if (m.replyTo) {
      const parent = messages.find((p) => p.id === m.replyTo);
      if (parent) {
        if (!repliesMap[m.replyTo]) repliesMap[m.replyTo] = [];
        repliesMap[m.replyTo].push(m);
      } else {
        topLevel.push(m);
      }
    } else if (!m.report) {
      topLevel.push(m);
    }
  });

  // append report messages at the end so they always appear as the most recent
  messages.forEach((m) => {
    if (m.report) topLevel.push(m);
  });

  topLevel.forEach((m, i) => {
    const prev = topLevel[i - 1];
    const next = topLevel[i + 1];

    renderMessage(m, prev, next, false, null);

    // render replies stacked below by time
    const replies = repliesMap[m.id];
    if (replies && replies.length > 0) {
      replies.forEach((r, ri) => {
        const rPrev = ri === 0 ? m : replies[ri - 1];
        const rNext = replies[ri + 1] || null;
        renderMessage(r, rPrev, rNext, true, m);
      });
    }
  });

  // only auto-scroll if user was already near the bottom
  if (shouldAutoScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderMessage(m, prev, next, isReply, parentMsg) {
    const isMe = isAdmin ? m.uid === "admin" : m.uid === myUid;

    /* Admin messages appear on the left, all non-admin messages on the right */
    let side;
    if (isAdmin) {
      side = m.is_admin ? "sent" : "recv";
    } else {
      side = m.is_admin ? "recv" : "sent";
    }

    /* replies from the same side as parent stay indented under parent;
       replies from the other side go to their natural side (not grouped under parent) */
    let isInlineReply = isReply;

    /* date separator when the day changes (or first message) */
    if (!isReply) {
      const sepLabel = daySeparator(m, prev);
      if (sepLabel) {
        const sep = document.createElement("div");
        sep.className = "time-sep";
        sep.innerHTML = `<b>${sepLabel}</b>`;
        messagesEl.appendChild(sep);
      }
    }

    /* grouping: only admin messages get grouped. Non-admin messages
       are always independent for full anonymity. */
    const canGroup = m.is_admin || isMe;
    const prevCanGroup = prev && (prev.is_admin || (isAdmin ? prev.uid === "admin" : prev.uid === myUid));
    const sepLabel = prev ? daySeparator(m, prev) : "";
    const samePrev = canGroup && prevCanGroup && prev && prev.uid === m.uid && !sepLabel;
    const sameNext = canGroup && next && next.uid === m.uid && !daySeparator(next, m) && (next.is_admin || (isAdmin ? next.uid === "admin" : next.uid === myUid));
    const isTail = !sameNext;

    const row = document.createElement("div");
    row.className = `row ${side}` + (samePrev ? "" : " group-start") + (isInlineReply ? " reply-row" : "");
    row.id = `msg-${m.id}`;

    const col = document.createElement("div");
    col.className = "bubble-col";

    /* no sender labels for clean look */

    const bubble = document.createElement("div");
    bubble.className = `bubble ${side}`;
    if (m.is_admin) bubble.classList.add("admin-bubble");
    if (m.report) bubble.classList.add("report-bubble");
    if (reportedMsgIds.has(m.id)) bubble.classList.add("reported");
    // admin: mark messages that have been reported by others
    if (isAdmin && !m.report && messages.some((r) => r.report && r.reportedMsgId === m.id)) {
      bubble.classList.add("reported");
    }
    // all non-reply messages get tails
    if (!isReply) bubble.classList.add("tail");
    if (samePrev) bubble.classList.add("stacked-top");
    if (sameNext) bubble.classList.add("stacked");

    /* soft-deleted messages */
    if (m.deleted) {
      bubble.textContent = "삭제된 메세지입니다";
      bubble.classList.add("deleted");
    } else if (m.image) {
      const imgWrap = document.createElement("div");
      imgWrap.className = "bubble-img-wrap";
      const img = document.createElement("img");
      img.className = "bubble-img";
      img.src = m.image;
      img.alt = "photo";
      const expandBtn = document.createElement("button");
      expandBtn.className = "bubble-img-expand";
      expandBtn.textContent = "⤢";
      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showFullImage(m.image);
      });
      imgWrap.appendChild(img);
      imgWrap.appendChild(expandBtn);
      bubble.appendChild(imgWrap);
      if (m.text) {
        const caption = document.createElement("div");
        caption.className = "bubble-caption";
        caption.textContent = m.text;
        bubble.appendChild(caption);
      }
    } else {
      bubble.textContent = m.text;
      if (m.edited) {
        const edited = document.createElement("span");
        edited.className = "edited-tag";
        edited.textContent = " (수정됨)";
        bubble.appendChild(edited);
      }
    }

    /* show blocked indicator (admin only sees this) */

    /* reply arrow outside the bubble */
    if (isReply) {
      bubble.classList.add("has-reply-arrow");
      const arrow = document.createElement("span");
      arrow.className = "reply-arrow";
      arrow.textContent = "↩";
      // determine parent side for arrow direction
      let parentSide;
      if (parentMsg) {
        if (isAdmin) {
          parentSide = parentMsg.is_admin ? "sent" : "recv";
        } else {
          parentSide = parentMsg.is_admin ? "recv" : "sent";
        }
      }
      if (parentSide === "sent") {
        arrow.classList.add("arrow-right");
      } else {
        arrow.classList.add("arrow-left");
      }
      // wrap bubble and arrow in a horizontal container
      const bubbleRow = document.createElement("div");
      bubbleRow.className = `bubble-row ${side}`;
      if (parentSide === "sent") {
        bubbleRow.appendChild(bubble);
        bubbleRow.appendChild(arrow);
      } else {
        bubbleRow.appendChild(arrow);
        bubbleRow.appendChild(bubble);
      }
      col.appendChild(bubbleRow);
    }

    /* context menu on tap (for non-deleted messages) */
    if (!m.deleted) {
      bubble.style.cursor = "pointer";
      if (m.report && m.reportedMsgId && isAdmin) {
        // report bubbles: tap to scroll to the reported message
        bubble.addEventListener("click", (e) => {
          e.stopPropagation();
          scrollToMessage(m.reportedMsgId);
        });
      } else {
        bubble.addEventListener("click", (e) => {
          e.stopPropagation();
          showContextMenu(e, m, isMe);
        });
      }
    }

    if (!isReply) {
      col.appendChild(bubble);
    }

    /* render reactions below the bubble (Slack-style) */
    if (m.reactions && Object.keys(m.reactions).length > 0) {
      const reactionsEl = document.createElement("div");
      reactionsEl.className = `reaction-badge ${side}`;

      // group by emoji and count
      const counts = {};
      const reactUid = isAdmin ? "admin" : myUid;
      Object.entries(m.reactions).forEach(([key, emoji]) => {
        if (!counts[emoji]) counts[emoji] = { count: 0, mine: false };
        counts[emoji].count++;
        if (key.startsWith(`${reactUid}_`)) counts[emoji].mine = true;
      });

      Object.entries(counts).forEach(([emoji, data]) => {
        const pill = document.createElement("button");
        pill.className = `reaction-pill${data.mine ? " mine" : ""}`;
        pill.innerHTML = `${emoji} <span class="reaction-count">${data.count}</span>`;
        pill.addEventListener("click", (e) => {
          e.stopPropagation();
          // toggle this specific emoji for current user
          addReactionBackend(m.id, emoji, reactUid);
        });
        reactionsEl.appendChild(pill);
      });

      // add reaction button (opens emoji picker)
      const addBtn = document.createElement("button");
      addBtn.className = "reaction-add-btn";
      addBtn.textContent = "☺+";
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showEmojiPicker(e, m);
      });
      reactionsEl.appendChild(addBtn);

      col.appendChild(reactionsEl);
    }

    row.appendChild(col);
    messagesEl.appendChild(row);
}

/* returns a label ("Today" / "Yesterday" / "Mon, Jul 14") if `m`
   starts a new day relative to `prev`, else "" */
function daySeparator(m, prev) {
  const d = tsToDate(m);
  if (!d) return "";
  if (prev) {
    const p = tsToDate(prev);
    if (p && sameDay(d, p)) return "";
  }
  return labelForDay(d);
}

function tsToDate(m) {
  // backend hands us a Date (or null for a beat until a server write lands)
  return m.createdAt instanceof Date ? m.createdAt : null;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
function labelForDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

/* ============================================================
   AUTH  —  everyone is anonymous by default.
   Two roles only:  anonymous  |  admin (password-gated).
   No user-chosen names: an anonymous tag is derived from the uid.
   ============================================================ */
function anonNameFor(uid) {
  // stable per-user tag like "익명#3f9a" so users are distinguishable
  return "익명#" + String(uid).slice(-4);
}

initAuth().then((uid) => {
  myUid = uid;
  myNick = anonNameFor(uid);
  showEntryGate();          // pick a role (anon by default), then enter
}).catch((e) => {
  console.error("auth failed", e);
  banner(IS_MOCK ? "초기화 실패" : "익명 로그인 실패 — Authentication에서 Anonymous를 켜세요");
});

/* ============================================================
   CONTEXT MENU  —  iOS-style long-press menu with reactions + actions
   ============================================================ */
let blockedUids = new Set(getBlockedUsers().map(b => b.uid));
let blockedList = getBlockedUsers();

const REACTIONS = ["❤️", "👍", "👎", "😂", "‼️", "❓", "🎉"];

function showContextMenu(e, msg, isMe) {
  // remove any existing menu
  document.querySelector(".ctx-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "ctx-overlay";

  const container = document.createElement("div");
  container.className = "ctx-container";

  // position near the tap
  const top = Math.min(e.clientY - 30, window.innerHeight - 280);
  const left = isMe
    ? Math.max(window.innerWidth - 320, 16)
    : Math.min(e.clientX - 20, window.innerWidth - 260);
  container.style.top = `${top}px`;
  container.style.left = `${left}px`;

  // --- Reaction bar ---
  const reactionBar = document.createElement("div");
  reactionBar.className = "ctx-reactions";
  REACTIONS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.className = "ctx-reaction-btn";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      addReaction(msg.id, emoji);
    });
    reactionBar.appendChild(btn);
  });
  container.appendChild(reactionBar);

  // --- Action list ---
  const actionList = document.createElement("div");
  actionList.className = "ctx-actions";

  const actions = getActions(msg, isMe);
  actions.forEach((action) => {
    const item = document.createElement("button");
    item.className = `ctx-action-item${action.danger ? " ctx-danger" : ""}`;
    item.innerHTML = `<span>${action.label}</span><span class="ctx-action-icon">${action.icon}</span>`;
    item.addEventListener("click", () => {
      overlay.remove();
      action.handler();
    });
    actionList.appendChild(item);
  });

  container.appendChild(actionList);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  // close on overlay click
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) overlay.remove();
  });
}

function deleteMessageWithReplies(msgId) {
  // delete the message itself
  removeMessage(msgId);
  // delete all replies to this message and reports referencing it
  messages.forEach((m) => {
    if (m.replyTo === msgId || m.reportedMsgId === msgId) {
      removeMessage(m.id);
    }
  });
}

function getActions(msg, isMe) {
  if (isAdmin && !isMe) {
    // admin viewing others' messages
    const actions = [];
    actions.push({ label: "답장", icon: "↩️", danger: false, handler: () => {
      // always reply to the top-level parent, not to a reply
      const target = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) || msg : msg;
      setReply(target);
    }});
    actions.push({ label: "삭제", icon: "🗑", danger: true, handler: () => {
      if (msg.report && msg.reportedMsgId) {
        // deleting a report: delete the reported message, its replies, and the report itself
        deleteMessageWithReplies(msg.reportedMsgId);
        removeMessage(msg.id);
      } else {
        deleteMessageWithReplies(msg.id);
      }
    }});
    actions.push({ label: "사용자 차단", icon: "🚫", danger: true, handler: () => {
      const isBlocked = blockedUids.has(msg.uid);
      if (isBlocked) { blockedUids.delete(msg.uid); import("./backend.js").then(b => b.unblockUser(msg.uid)); }
      else { blockedUids.add(msg.uid); blockUser(msg.uid, msg.text); }
      render();
    }});
    return actions;
  } else if (isAdmin && isMe) {
    // admin viewing own messages
    const actions = [];
    actions.push({ label: "답장", icon: "↩️", danger: false, handler: () => {
      const target = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) || msg : msg;
      setReply(target);
    }});
    actions.push({ label: "수정", icon: "✏️", danger: false, handler: () => {
      const newText = prompt("메시지 수정:", msg.text);
      if (newText !== null && newText.trim()) editMessage(msg.id, newText.trim());
    }});
    actions.push({ label: "삭제", icon: "🗑", danger: true, handler: () => removeMessage(msg.id) });
    return actions;
  } else if (!isAdmin && isMe) {
    // non-admin viewing own messages
    const actions = [];
    actions.push({ label: "답장", icon: "↩️", danger: false, handler: () => {
      const target = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) || msg : msg;
      setReply(target);
    }});
    actions.push({ label: "삭제", icon: "🗑", danger: true, handler: () => softDeleteMessage(msg.id) });
    if (!msg.is_admin) {
      if (reportedMsgIds.has(msg.id)) {
        actions.push({ label: "신고 취소", icon: "↩️", danger: false, handler: () => unreportMessage(msg) });
      } else {
        actions.push({ label: "신고", icon: "🚨", danger: true, handler: () => reportMessage(msg) });
      }
    }
    return actions;
  } else {
    // non-admin viewing others' messages
    const actions = [];
    actions.push({ label: "답장", icon: "↩️", danger: false, handler: () => {
      const target = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) || msg : msg;
      setReply(target);
    }});
    if (!msg.is_admin) {
      if (reportedMsgIds.has(msg.id)) {
        actions.push({ label: "신고 취소", icon: "↩️", danger: false, handler: () => unreportMessage(msg) });
      } else {
        actions.push({ label: "신고", icon: "🚨", danger: true, handler: () => reportMessage(msg) });
      }
    }
    return actions;
  }
}

function addReaction(msgId, emoji) {
  const reactUid = isAdmin ? "admin" : myUid;
  addReactionBackend(msgId, emoji, reactUid);
}

async function reportMessage(msg) {
  const preview = msg.text.length > 50 ? msg.text.slice(0, 50) + "…" : msg.text;
  const reportText = `🚨 신고된 메시지: "${preview}"`;
  const sendUid = myUid;
  try {
    await sendMessage({ uid: sendUid, nick: "신고", text: reportText, is_admin: false, report: true, reportedMsgId: msg.id });
    reportedMsgIds.add(msg.id);
    saveReportedIds();
    render();
    banner("신고가 접수되었습니다");
  } catch (e) {
    console.error("report failed", e);
    banner("신고 실패");
  }
}

async function unreportMessage(msg) {
  const reportMsg = allMessages.find((m) => m.report && m.reportedMsgId === msg.id && m.uid === myUid);
  if (reportMsg) {
    await removeMessage(reportMsg.id);
  }
  reportedMsgIds.delete(msg.id);
  saveReportedIds();
  render();
  banner("신고가 취소되었습니다");
}

function showEmojiPicker(e, msg) {
  document.querySelector(".emoji-picker-wrap")?.remove();

  const wrap = document.createElement("div");
  wrap.className = "emoji-picker-wrap";

  const picker = document.createElement("emoji-picker");
  picker.addEventListener("emoji-click", (ev) => {
    addReaction(msg.id, ev.detail.unicode);
    wrap.remove();
  });

  wrap.appendChild(picker);
  document.body.appendChild(wrap);

  // position near the clicked button
  const rect = e.target.getBoundingClientRect();
  const pickerH = 320;
  const pickerW = 300;

  // try to show above the button; if no room, show below
  let top = rect.top - pickerH - 8;
  if (top < 10) top = rect.bottom + 8;
  let left = Math.min(rect.left, window.innerWidth - pickerW - 10);
  if (left < 10) left = 10;

  wrap.style.top = `${top}px`;
  wrap.style.left = `${left}px`;

  // close on outside click
  setTimeout(() => {
    const close = (ev) => {
      if (!wrap.contains(ev.target)) { wrap.remove(); document.removeEventListener("click", close); }
    };
    document.addEventListener("click", close);
  }, 10);
}

/* ============================================================
   COMPOSER
   ============================================================ */
const input   = $("#msgInput");
const sendBtn = $("#sendBtn");
let replyingTo = null; // { id, text } of message being replied to

function toggleSend() {
  const has = input.value.trim().length > 0 || pendingPhoto;
  sendBtn.hidden = !has;
}

function setReply(msg) {
  replyingTo = { id: msg.id, text: msg.text };
  let bar = document.querySelector(".reply-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "reply-bar";
    document.querySelector(".composer").insertAdjacentElement("beforebegin", bar);
  }
  const preview = msg.text.length > 30 ? msg.text.slice(0, 30) + "…" : msg.text;
  bar.innerHTML = `<span class="reply-bar-text">↩️ ${preview}</span><button class="reply-bar-close">✕</button>`;
  bar.querySelector(".reply-bar-close").addEventListener("click", clearReply);
  input.focus();
}

function clearReply() {
  replyingTo = null;
  document.querySelector(".reply-bar")?.remove();
}

/* check if current user is blocked and disable composer */
function checkIfBlocked() {
  const blocked = !isAdmin && blockedUids.has(myUid);
  input.disabled = blocked;
  if (blocked) {
    input.placeholder = "차단된 사용자입니다";
    sendBtn.hidden = true;
  } else {
    input.placeholder = isAdmin ? "관리자 모드입니다" : "iMessage";
    toggleSend();
  }
  return blocked;
}

async function send() {
  const text = input.value.trim();
  if (!text && !pendingPhoto || !myUid) return;
  if (checkIfBlocked()) {
    banner("차단되어 메시지를 보낼 수 없습니다");
    return;
  }
  input.value = "";
  toggleSend();
  const nick = isAdmin ? "관리자" : myNick;
  const sendUid = isAdmin ? "admin" : myUid;
  const msgData = { uid: sendUid, nick, text, is_admin: isAdmin };
  if (pendingPhoto) { msgData.image = pendingPhoto; pendingPhoto = null; removePhotoPreview(); }
  if (replyingTo) { msgData.replyTo = replyingTo.id; }
  clearReply();
  try { await sendMessage(msgData); }
  catch (e) { console.error("send failed", e); banner("전송 실패"); }
}

input.addEventListener("input", toggleSend);
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) send(); });
sendBtn.addEventListener("click", send);

/* ============================================================
   PHOTO UPLOAD
   ============================================================ */

function showFullImage(src) {
  const overlay = document.createElement("div");
  overlay.className = "img-overlay";
  const img = document.createElement("img");
  img.src = src;
  overlay.appendChild(img);
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

function scrollToMessage(msgId) {
  const el = document.getElementById(`msg-${msgId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("highlight-flash");
    setTimeout(() => el.classList.remove("highlight-flash"), 2000);
  }
}

const photoBtn = $("#photoBtn");
const photoInput = $("#photoInput");
let pendingPhoto = null; // stores the compressed data URL until user sends

photoBtn.addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  if (!file) return;
  photoInput.value = "";

  // compress and convert to base64
  const dataUrl = await compressImage(file, 800, 0.7);
  pendingPhoto = dataUrl;
  showPhotoPreview(dataUrl);
  input.focus();
  toggleSend();
});

function showPhotoPreview(dataUrl) {
  removePhotoPreview();
  const preview = document.createElement("div");
  preview.className = "photo-preview";
  preview.innerHTML = `
    <img src="${dataUrl}" class="photo-preview-img" />
    <button class="photo-preview-close">✕</button>
  `;
  preview.querySelector(".photo-preview-close").addEventListener("click", () => {
    pendingPhoto = null;
    removePhotoPreview();
    toggleSend();
  });
  document.querySelector(".composer").insertAdjacentElement("beforebegin", preview);
}

function removePhotoPreview() {
  document.querySelector(".photo-preview")?.remove();
}

function compressImage(file, maxWidth, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = (maxWidth / w) * h; w = maxWidth; }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   ADMIN TOGGLE — triple-click header avatar to toggle admin mode
   ============================================================ */
function refilterMessages() {
  if (!isAdmin) {
    messages = allMessages.filter((m) => !blockedUids.has(m.uid) && !m.report);
  } else {
    messages = allMessages;
  }
}

(function() {
  const avatar = document.querySelector(".hdr-avatar");
  if (!avatar) return;
  let tapCount = 0;
  let tapTimer = null;
  avatar.addEventListener("click", () => {
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, 500);
    if (tapCount >= 3) {
      tapCount = 0;
      if (isAdmin) {
        // toggle off admin
        isAdmin = false;
        checkIfBlocked();
        refilterMessages();
        render();
        banner("관리자 모드 해제");
      } else {
        // prompt for password
        const pass = prompt("관리자 비밀번호:");
        if (pass === ADMIN_PASSCODE) {
          isAdmin = true;
          checkIfBlocked();
          refilterMessages();
          render();
          banner("관리자 모드 활성화");
        } else if (pass !== null) {
          banner("비밀번호가 틀렸습니다");
        }
      }
    }
  });
})();

/* ============================================================
   ADMIN MENU (3-dot button) — blocked users panel
   ============================================================ */
document.querySelector(".hdr-menu")?.addEventListener("click", () => {
  if (!isAdmin) return;
  showBlockedPanel();
});

function showBlockedPanel() {
  document.querySelector(".blocked-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "blocked-panel";

  panel.innerHTML = `
    <div class="blocked-panel-content">
      <div class="blocked-panel-header">
        <h3>차단된 사용자</h3>
        <button class="blocked-panel-close">✕</button>
      </div>
      <div class="blocked-panel-list">
        ${blockedList.length === 0
          ? '<div class="blocked-panel-empty">차단된 사용자가 없습니다</div>'
          : blockedList.map((b) => `
            <div class="blocked-panel-item">
              <div class="blocked-panel-info">
                <span class="blocked-panel-uid">익명#${b.uid.slice(-4)}</span>
                ${b.reason ? `<span class="blocked-panel-reason">"${b.reason}"</span>` : ""}
              </div>
              <button class="blocked-panel-unblock" data-uid="${b.uid}">차단 해제</button>
            </div>
          `).join("")
        }
      </div>
    </div>
  `;

  panel.querySelector(".blocked-panel-close").addEventListener("click", () => panel.remove());
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });

  panel.querySelectorAll(".blocked-panel-unblock").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.uid;
      blockedUids.delete(uid);
      const { unblockUser } = await import("./backend.js");
      await unblockUser(uid);
      panel.remove();
      showBlockedPanel(); // refresh
    });
  });

  document.body.appendChild(panel);
}

/* ============================================================
   ENTRY — No gate, start immediately as anonymous.
   Admin mode toggled by triple-clicking the header avatar.
   ============================================================ */
function showEntryGate() {
  // no gate — start directly
  isAdmin = false;
  startChat();
}

/* ---------- start ---------- */
let started = false;
function startChat() {
  if (started) return;
  started = true;
  checkIfBlocked();
  subscribeBlocked((list) => { blockedList = list; blockedUids = new Set(list.map(b => b.uid)); checkIfBlocked(); render(); });
  subscribe((list) => {
    allMessages = list;
    // filter out blocked users' messages for non-admin viewers
    // filter out report messages for non-admin viewers
    if (!isAdmin) {
      messages = list.filter((m) => !blockedUids.has(m.uid) && !m.report);
    } else {
      messages = list;
    }
    render();
  });
  toggleSend();
}

/* small non-blocking error banner */
function banner(msg) {
  let b = $("#banner");
  if (!b) {
    b = document.createElement("div");
    b.id = "banner";
    b.className = "banner";
    document.body.appendChild(b);
  }
  b.textContent = msg;
  b.style.display = "block";
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => { b.style.display = "none"; }, 3000);
}
