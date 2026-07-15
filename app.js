/* ============================================================
   iMessage UI  —  realtime chat (backend-agnostic)
   ------------------------------------------------------------
   This file is pure UI/UX. It talks only to ./backend.js, which
   is either the local mock (localStorage, no Firebase) or real
   Firebase — controlled by USE_MOCK in firebase-config.js.

   Message object: { id, uid, nick, text, is_admin, createdAt:Date }
   Renders blue "sent" when uid === my uid, else gray "recv".
   ============================================================ */

import { initAuth, subscribe, sendMessage, removeMessage, softDeleteMessage, editMessage, addReaction as addReactionBackend, removeReaction as removeReactionBackend, blockUser, getBlockedUsers, subscribeBlocked, sendDm, removeDm, subscribeDm, saveToGallery, subscribeGallery, removeFromGallery, setNotice, subscribeNotice, searchMessages, loadMoreMessages, IS_MOCK } from "./backend.js";
import { verifyAdmin, setAdminPasscode, adminDeleteMessage, adminDeleteMessages, adminUpdateMessage, adminBlock, adminUnblock, adminDeleteDm, adminDeleteGallery, adminSetNotice } from "./admin-api.js";
import "emoji-picker-element";

const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages");

/* restore saved settings */
(function() {
  const savedSize = localStorage.getItem("fontSize");
  if (savedSize) document.documentElement.style.setProperty("--bubble-font-size", `${savedSize}px`);
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme) {
    document.documentElement.dataset.theme = savedTheme;
  } else {
    // follow device setting
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
  }
  // listen for device theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!localStorage.getItem("theme")) {
      document.documentElement.dataset.theme = e.matches ? "dark" : "light";
    }
  });
})();

/* ---------- local state ---------- */
let myUid   = null;
let myNick  = "";          // derived from uid on sign-in (anonymous tag)
let isAdmin = localStorage.getItem("isAdmin") === "true";
// restore admin passcode for API calls
if (isAdmin) {
  const storedPass = localStorage.getItem("ap");
  if (storedPass) setAdminPasscode(atob(storedPass));
}
let messages = [];               // filtered list for rendering
let allMessages = [];            // unfiltered list for lookups
let dmMessages = [];             // DM messages (admin only)
let galleryItems = [];           // gallery photos
let initialLoad = true;          // force scroll to bottom for first 3 seconds
let reportedMsgIds = new Set(JSON.parse(localStorage.getItem("reportedMsgIds") || "[]"));

/* debounced render — batches rapid updates (reactions, etc.) into one render */
let renderTimer = null;
let skipNextScroll = false;
function debouncedRender() {
  if (renderTimer) cancelAnimationFrame(renderTimer);
  renderTimer = requestAnimationFrame(() => { renderTimer = null; skipNextScroll = true; render(); });
}

function saveReportedIds() {
  localStorage.setItem("reportedMsgIds", JSON.stringify([...reportedMsgIds]));
}

/* ============================================================
   RENDERING  (your original iMessage logic, driven by live data)
   ============================================================ */
function render() {
  // check if user is near the bottom before re-rendering
  const shouldAutoScroll = !skipNextScroll && (initialLoad || messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 50);
  skipNextScroll = false;

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
    requestAnimationFrame(() => { messagesEl.scrollTop = 999999; });
    if (initialLoad) {
      const imgs = messagesEl.querySelectorAll("img");
      imgs.forEach((img) => {
        if (!img.complete) {
          img.addEventListener("load", () => { messagesEl.scrollTop = 999999; }, { once: true });
        }
      });
      // extra delayed scroll as final fallback
      setTimeout(() => { messagesEl.scrollTop = 999999; }, 500);
    }
  }

  // restore search highlights if search is active
  if (document.querySelector(".search-bar")) {
    const searchInput = document.querySelector(".search-input");
    if (searchInput && searchInput.value.trim()) {
      const query = searchInput.value.trim();
      const queryLower = query.toLowerCase();
      searchResults = [];
      messages.forEach((m) => {
        if (m.text && m.text.toLowerCase().includes(queryLower)) {
          const row = document.getElementById(`msg-${m.id}`);
          if (row) {
            const bubble = row.querySelector(".bubble");
            if (bubble) {
              highlightTextInBubble(bubble, query);
              searchResults.push(row);
            }
          }
        }
      });
      if (searchResults.length > 0) {
        if (searchIndex >= searchResults.length) searchIndex = searchResults.length - 1;
        if (searchIndex < 0) searchIndex = searchResults.length - 1;
        const row = searchResults[searchIndex];
        const match = row?.querySelector(".search-match");
        if (match) match.classList.add("search-active");
      }
    }
  }
}

function showDmMenu(e, msg, bubbleEl) {
  // dismiss keyboard
  input.blur();
  document.querySelector(".ctx-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "ctx-overlay";

  // elevate the original bubble
  const bubble = bubbleEl || e.currentTarget;
  bubble.classList.add("ctx-elevated");

  // delay to let viewport settle after keyboard dismissal
  requestAnimationFrame(() => { setTimeout(() => {
  const rect = bubble.getBoundingClientRect();
  const bubbleHeight = rect.bottom - rect.top;
  const gap = 8;
  const reactionBarH = 48;

  let actionY, reactionY;

  const composerEl = document.querySelector(".composer");
  const composerTop = composerEl.getBoundingClientRect().top;
  const normalActionY = rect.bottom + gap;
  const actionEstimate = 80;

  if (normalActionY + actionEstimate > composerTop) {
    const availableForActions = composerTop - gap;
    const targetBubbleBottom = availableForActions - actionEstimate - gap;
    const targetBubbleTop = targetBubbleBottom - bubbleHeight;
    const shiftAmount = rect.top - targetBubbleTop;
    bubble.style.transform = `translateY(-${shiftAmount}px)`;
    bubble.style.transition = "transform .2s ease";
    actionY = targetBubbleBottom + gap;
    reactionY = targetBubbleTop - gap - reactionBarH;
  } else {
    actionY = normalActionY;
    reactionY = rect.top - gap - reactionBarH;
  }

  // reactions above
  const container = document.createElement("div");
  container.className = "ctx-container";
  container.style.left = `${rect.left}px`;
  container.style.top = `${reactionY}px`;
  container.style.alignItems = "flex-start";

  const reactionBar = document.createElement("div");
  reactionBar.className = "ctx-reactions";
  REACTIONS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.className = "ctx-reaction-btn";
    btn.textContent = emoji;
    btn.addEventListener("click", () => { addReaction(msg.id, emoji); closeMenu(); });
    reactionBar.appendChild(btn);
  });
  const moreBtn = document.createElement("button");
  moreBtn.className = "ctx-reaction-btn ctx-reaction-more";
  moreBtn.textContent = "+";
  moreBtn.addEventListener("click", (ev) => {
    const bubbleRect = bubble.getBoundingClientRect();
    closeMenu();
    showEmojiPicker(ev, msg, bubbleRect);
  });
  reactionBar.appendChild(moreBtn);
  container.appendChild(reactionBar);

  // actions below
  const actionContainer = document.createElement("div");
  actionContainer.className = "ctx-actions-wrap";
  actionContainer.style.position = "fixed";
  actionContainer.style.left = `${rect.left}px`;
  actionContainer.style.top = `${actionY}px`;

  const actionList = document.createElement("div");
  actionList.className = "ctx-actions";

  const actions = [
    { label: "삭제", icon: ICONS.delete, danger: true, handler: () => doDeleteDm(msg.id) },
  ];

  // if user is blocked, show unblock option; otherwise show block
  if (blockedUids.has(msg.uid)) {
    actions.push({ label: "차단 해제", icon: ICONS.unreport, danger: false, handler: async () => {
      blockedUids.delete(msg.uid);
      await doUnblock(msg.uid);
      render();
      banner("차단이 해제되었습니다", "#34c759");
    }});
  } else {
    actions.push({ label: "사용자 차단", icon: ICONS.block, danger: true, handler: () => {
      blockedUids.add(msg.uid);
      doBlock(msg.uid, msg.text || "[DM]");
      render();
    }});
  }

  actions.forEach((action) => {
    const item = document.createElement("button");
    item.className = `ctx-action-item${action.danger ? " ctx-danger" : ""}`;
    item.innerHTML = `<span class="ctx-action-icon">${action.icon}</span><span>${action.label}</span>`;
    item.addEventListener("click", () => { closeMenu(); action.handler(); });
    actionList.appendChild(item);
  });

  actionContainer.appendChild(actionList);
  overlay.appendChild(container);
  overlay.appendChild(actionContainer);
  document.body.appendChild(overlay);

  const closeMenu = () => {
    bubble.classList.remove("ctx-elevated");
    bubble.style.transform = "";
    bubble.style.transition = "";
    overlay.remove();
  };
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) closeMenu(); });
  }, 100); });
}

function renderMessage(m, prev, next, isReply, parentMsg) {
    const isMe = isAdmin ? m.uid === "admin" : m.uid === myUid;

    /* Admin messages appear on the left, all non-admin messages on the right */
    let side;
    if (isReply && parentMsg) {
      // replies always follow parent's side
      if (isAdmin) {
        side = parentMsg.is_admin ? "sent" : "recv";
      } else {
        side = parentMsg.is_admin ? "recv" : "sent";
      }
    } else if (isAdmin) {
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
    if (isReply) {
      // admin view: admin replies = blue (mine), user replies = gray (other)
      // non-admin view: user replies = blue (mine), admin replies = gray (other)
      const replyIsMine = isAdmin ? m.is_admin : !m.is_admin;
      bubble.classList.add(replyIsMine ? "reply-mine" : "reply-other");
    }
    if (m.report) bubble.classList.add("report-bubble");
    if (m.dm) {
      bubble.classList.add("dm-bubble");
      // if petition is resolved (user unblocked), mark it
      if (m.text && m.text.includes("[이의 제기]") && !blockedUids.has(m.uid)) {
        bubble.classList.add("dm-resolved");
      }
    }
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
    } else if (m.galleryId || m.image) {
      // look up image from gallery collection, fall back to m.image for old messages
      const galleryItem = m.galleryId ? galleryItems.find((g) => g.id === m.galleryId) : null;
      const imageSrc = galleryItem ? galleryItem.image : m.image;
      if (imageSrc) {
        const imgWrap = document.createElement("div");
        imgWrap.className = "bubble-img-wrap";
        const img = document.createElement("img");
        img.className = "bubble-img";
        img.src = imageSrc;
        img.alt = "photo";
        const expandBtn = document.createElement("button");
        expandBtn.className = "bubble-img-expand";
        expandBtn.textContent = "⤢";
        expandBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          showFullImage(imageSrc);
        });
        imgWrap.appendChild(img);
        imgWrap.appendChild(expandBtn);
        bubble.appendChild(imgWrap);
      } else {
        // gallery item was deleted
        bubble.textContent = "삭제된 사진입니다";
        bubble.classList.add("deleted");
      }
      if (m.text) {
        const caption = document.createElement("div");
        caption.className = "bubble-caption";
        caption.textContent = m.text;
        bubble.appendChild(caption);
      }
    } else {
      // detect URLs and make them clickable
      const urlRegex = /(https?:\/\/[^\s]+|(?:www\.|(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|dev|app|co|me|tv|gg|xyz|kr|jp))[^\s]*)/g;
      const twitterRegex = /^https?:\/\/(twitter\.com|x\.com)\/.+\/status\/\d+/i;
      const instagramRegex = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[\w-]+/i;

      if (m.text.match(urlRegex)) {
        const urls = m.text.match(urlRegex);
        // render text with clickable links (add https:// if missing)
        bubble.innerHTML = m.text.replace(urlRegex, (match) => {
          const href = match.startsWith("http") ? match : `https://${match}`;
          return `<a href="${href}" target="_blank" rel="noopener" class="bubble-link">${match}</a>`;
        });
        // embed or preview for each URL
        urls.forEach((url) => {
          const fullUrl = url.startsWith("http") ? url : `https://${url}`;
          if (twitterRegex.test(fullUrl)) {
            embedTwitter(fullUrl, bubble);
          } else if (instagramRegex.test(fullUrl)) {
            embedInstagram(fullUrl, bubble);
          } else {
            fetchLinkPreview(fullUrl, bubble);
          }
        });
      } else {
        bubble.textContent = m.text;
      }
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
      arrow.innerHTML = `<svg viewBox="0 0 16 16"><path d="M14 12C14 8 11 5 7 5H3M3 5l3-3M3 5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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

    /* context menu on long press (for non-deleted messages) */
    if (!m.deleted) {
      bubble.style.cursor = "pointer";
      let pressTimer = null;
      let pressTriggered = false;

      // report bubbles: single tap to scroll to reported message
      if (m.report && m.reportedMsgId && isAdmin) {
        bubble.addEventListener("click", (e) => {
          if (!pressTriggered) {
            e.stopPropagation();
            scrollToMessage(m.reportedMsgId);
          }
        });
      }

      bubble.addEventListener("touchstart", (e) => {
        if (e.target.closest("a")) return;
        const targetBubble = bubble;
        pressTriggered = false;
        bubble.style.userSelect = "none";
        bubble.style.webkitUserSelect = "none";
        pressTimer = setTimeout(() => {
          pressTimer = null;
          pressTriggered = true;
          bubble.style.userSelect = "text";
          bubble.style.webkitUserSelect = "text";
          if (m.dm && isAdmin) {
            showDmMenu(e, m, targetBubble);
          } else {
            showContextMenu(e, m, side === "sent", targetBubble);
          }
        }, 500);
      }, { passive: true });

      bubble.addEventListener("touchend", () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        bubble.style.userSelect = "";
        bubble.style.webkitUserSelect = "";
      });
      bubble.addEventListener("touchmove", () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        bubble.style.userSelect = "";
        bubble.style.webkitUserSelect = "";
      });

      // desktop: use mousedown
      bubble.addEventListener("mousedown", (e) => {
        if (e.target.closest("a")) return; // let links be clickable
        const targetBubble = bubble;
        pressTriggered = false;
        pressTimer = setTimeout(() => {
          pressTimer = null;
          pressTriggered = true;
          if (m.dm && isAdmin) {
            showDmMenu(e, m, targetBubble);
          } else {
            showContextMenu(e, m, side === "sent", targetBubble);
          }
        }, 500);
      });
      bubble.addEventListener("mouseup", () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      });
      bubble.addEventListener("mouseleave", () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      });
    }

    if (!isReply) {
      col.appendChild(bubble);
    }

    /* render reactions below the bubble (Slack-style) */
    if (m.reactions && Object.keys(m.reactions).length > 0) {
      const reactionsEl = document.createElement("div");
      reactionsEl.className = `reaction-badge ${side}`;

      // group by emoji and count, preserving stable order (sorted by codepoint)
      const counts = {};
      const reactUid = isAdmin ? "admin" : myUid;
      Object.entries(m.reactions).forEach(([key, emoji]) => {
        if (!counts[emoji]) { counts[emoji] = { count: 0, mine: false }; }
        counts[emoji].count++;
        if (key.startsWith(`${reactUid}_`)) counts[emoji].mine = true;
      });

      const emojiOrder = Object.keys(counts).sort();
      emojiOrder.forEach((emoji) => {
        const data = counts[emoji];
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
      addBtn.textContent = "+";
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
  const kstA = new Date(a.getTime() + 9 * 60 * 60 * 1000);
  const kstB = new Date(b.getTime() + 9 * 60 * 60 * 1000);
  return kstA.getUTCFullYear() === kstB.getUTCFullYear()
    && kstA.getUTCMonth() === kstB.getUTCMonth()
    && kstA.getUTCDate() === kstB.getUTCDate();
}
function labelForDay(d) {
  // convert to KST (UTC+9)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
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

const REACTIONS = ["👍", "👎", "🫪", "❓"];

const ICONS = {
  reply: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 4l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h14a4 4 0 0 1 4 4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  delete: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  block: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.93 4.93l14.14 14.14" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  report: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 22V15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  unreport: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 4l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

function showContextMenu(e, msg, isMe, bubbleEl) {
  // dismiss keyboard and wait for viewport to adjust
  input.blur();
  // remove any existing menu
  document.querySelector(".ctx-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "ctx-overlay";

  // elevate the original bubble above the overlay
  const bubble = bubbleEl || e.currentTarget;
  bubble.classList.add("ctx-elevated");

  // delay to let viewport settle after keyboard dismissal
  requestAnimationFrame(() => { setTimeout(() => {
    const avatarEl = document.querySelector(".hdr-avatar");
    const safeTop = avatarEl ? avatarEl.getBoundingClientRect().top : 60;
    let rect = bubble.getBoundingClientRect();

    const container = document.createElement("div");
    container.className = "ctx-container";

  const bubbleHeight = rect.bottom - rect.top;
  const gap = 8;
  const reactionBarH = 48;

  let actionY, reactionY;

  const composerEl = document.querySelector(".composer");
  const composerTop = composerEl.getBoundingClientRect().top;
  const normalActionY = rect.bottom + gap;

  const actionEstimate = 80;

  // check if not enough space above for reaction bar
  const spaceAbove = rect.top - safeTop;
  const needsDownShift = spaceAbove < reactionBarH + gap;

  // check if not enough space below for actions
  const needsUpShift = normalActionY + actionEstimate > composerTop;

  if (needsDownShift && !needsUpShift) {
    // scroll bubble down so reaction bar fits below header
    actionY = rect.bottom + gap;
    reactionY = safeTop;
  } else if (needsUpShift) {
    const availableForActions = composerTop - gap;
    const targetBubbleBottom = availableForActions - actionEstimate - gap;
    const targetBubbleTop = targetBubbleBottom - bubbleHeight;
    const shiftAmount = rect.top - targetBubbleTop;
    bubble.style.transform = `translateY(-${shiftAmount}px)`;
    bubble.style.transition = "transform .2s ease";
    actionY = targetBubbleBottom + gap;
    reactionY = targetBubbleTop - gap - reactionBarH;
  } else {
    actionY = normalActionY;
    reactionY = rect.top - gap - reactionBarH;
  }

  // position reactions above - align to same side as bubble
  if (isMe) {
    container.style.left = "auto";
    container.style.right = `${window.innerWidth - rect.right}px`;
    container.style.top = `${reactionY}px`;
    container.style.alignItems = "flex-end";
  } else {
    container.style.right = "auto";
    container.style.left = `${rect.left}px`;
    container.style.top = `${reactionY}px`;
    container.style.alignItems = "flex-start";
  }

  // --- Reaction bar ---
  const reactionBar = document.createElement("div");
  reactionBar.className = "ctx-reactions";
  REACTIONS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.className = "ctx-reaction-btn";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      addReaction(msg.id, emoji);
      closeMenu();
    });
    reactionBar.appendChild(btn);
  });
  // more emojis button
  const moreBtn = document.createElement("button");
  moreBtn.className = "ctx-reaction-btn ctx-reaction-more";
  moreBtn.textContent = "+";
  moreBtn.addEventListener("click", (e) => {
    const bubbleRect = bubble.getBoundingClientRect();
    closeMenu();
    showEmojiPicker(e, msg, bubbleRect);
  });
  reactionBar.appendChild(moreBtn);
  container.appendChild(reactionBar);

  // --- Action list (positioned below the bubble) ---
  const actionContainer = document.createElement("div");
  actionContainer.className = "ctx-actions-wrap";
  if (isMe) {
    actionContainer.style.position = "fixed";
    actionContainer.style.left = "auto";
    actionContainer.style.right = `${window.innerWidth - rect.right}px`;
    actionContainer.style.top = `${actionY}px`;
  } else {
    actionContainer.style.position = "fixed";
    actionContainer.style.right = "auto";
    actionContainer.style.left = `${rect.left}px`;
    actionContainer.style.top = `${actionY}px`;
  }

  const actionList = document.createElement("div");
  actionList.className = "ctx-actions";

  const actualIsMe = isAdmin ? msg.uid === "admin" : msg.uid === myUid;
  const actions = getActions(msg, actualIsMe);
  actions.forEach((action) => {
    const item = document.createElement("button");
    item.className = `ctx-action-item${action.danger ? " ctx-danger" : ""}`;
    item.innerHTML = `<span class="ctx-action-icon">${action.icon}</span><span>${action.label}</span>`;
    item.addEventListener("click", () => {
      closeMenu();
      action.handler();
    });
    actionList.appendChild(item);
  });

  actionContainer.appendChild(actionList);
  overlay.appendChild(container);
  overlay.appendChild(actionContainer);
  document.body.appendChild(overlay);

  // close on overlay click — remove elevated class
  const closeMenu = () => {
    bubble.classList.remove("ctx-elevated");
    bubble.style.transform = "";
    bubble.style.transition = "";
    overlay.remove();
  };
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeMenu();
  });
  }, 100); });
}

/* Admin-aware action wrappers */
async function doDeleteMessage(id) {
  if (isAdmin) await adminDeleteMessage(id);
  else await removeMessage(id);
}

async function doDeleteGallery(id) {
  if (isAdmin) await adminDeleteGallery(id);
  else await removeFromGallery(id);
}

async function doBlock(uid, reason) {
  if (isAdmin) await adminBlock(uid, reason);
  else await blockUser(uid, reason);
}

async function doUnblock(uid) {
  if (isAdmin) await adminUnblock(uid);
  else {
    const { unblockUser: ub } = await import("./backend.js");
    await ub(uid);
  }
}

async function doEditMessage(id, newText) {
  if (isAdmin) await adminUpdateMessage(id, { text: newText, edited: true });
  else await editMessage(id, newText);
}

async function doDeleteDm(id) {
  if (isAdmin) await adminDeleteDm(id);
  else await removeDm(id);
}

async function doSetNotice(text) {
  if (isAdmin) await adminSetNotice(text);
  else await setNotice(text);
}

async function deleteMessageWithReplies(msgId) {
  const msg = messages.find((m) => m.id === msgId);
  if (msg && msg.galleryId) {
    await doDeleteGallery(msg.galleryId);
  }
  // collect all IDs to delete
  const idsToDelete = [msgId];
  messages.forEach((m) => {
    if (m.replyTo === msgId || m.reportedMsgId === msgId) {
      idsToDelete.push(m.id);
    }
  });
  if (isAdmin) {
    await adminDeleteMessages(idsToDelete);
  } else {
    for (const id of idsToDelete) await removeMessage(id);
  }
}

function getActions(msg, isMe) {
  if (isAdmin && !isMe) {
    // admin viewing others' messages
    const actions = [];
    actions.push({ label: "답장", icon: ICONS.reply, danger: false, handler: () => {
      // always reply to the top-level parent, not to a reply
      const target = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) || msg : msg;
      setReply(target);
    }});
    actions.push({ label: "삭제", icon: ICONS.delete, danger: true, handler: () => {
      if (msg.report && msg.reportedMsgId) {
        // deleting a report: delete the reported message, its replies, and the report itself
        deleteMessageWithReplies(msg.reportedMsgId);
        removeMessage(msg.id);
      } else {
        deleteMessageWithReplies(msg.id);
      }
    }});
    actions.push({ label: "사용자 차단", icon: ICONS.block, danger: true, handler: () => {
      const isBlocked = blockedUids.has(msg.uid);
      if (isBlocked) { blockedUids.delete(msg.uid); doUnblock(msg.uid); }
      else { blockedUids.add(msg.uid); doBlock(msg.uid, msg.text); }
      render();
    }});
    return actions;
  } else if (isAdmin && isMe) {
    // admin viewing own messages
    const actions = [];
    actions.push({ label: "답장", icon: ICONS.reply, danger: false, handler: () => {
      const target = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) || msg : msg;
      setReply(target);
    }});
    actions.push({ label: "수정", icon: ICONS.edit, danger: false, handler: () => {
      const newText = prompt("메시지 수정:", msg.text);
      if (newText !== null && newText.trim()) doEditMessage(msg.id, newText.trim());
    }});
    actions.push({ label: "삭제", icon: ICONS.delete, danger: true, handler: () => {
      if (msg.galleryId) doDeleteGallery(msg.galleryId);
      removeMessage(msg.id);
    }});
    return actions;
  } else if (!isAdmin && isMe) {
    // non-admin viewing own messages
    const actions = [];
    actions.push({ label: "답장", icon: ICONS.reply, danger: false, handler: () => {
      const target = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) || msg : msg;
      setReply(target);
    }});
    actions.push({ label: "삭제", icon: ICONS.delete, danger: true, handler: () => {
      const hasReplies = allMessages.some((r) => r.replyTo === msg.id);
      // delete gallery photo if message has one
      if (msg.galleryId) {
        doDeleteGallery(msg.galleryId);
      }
      if (hasReplies) {
        softDeleteMessage(msg.id);
      } else {
        removeMessage(msg.id);
      }
    }});
    return actions;
  } else {
    // non-admin viewing others' messages
    const actions = [];
    actions.push({ label: "답장", icon: ICONS.reply, danger: false, handler: () => {
      const target = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) || msg : msg;
      setReply(target);
    }});
    if (!msg.is_admin) {
      if (reportedMsgIds.has(msg.id)) {
        actions.push({ label: "신고 취소", icon: ICONS.unreport, danger: false, handler: () => unreportMessage(msg) });
      } else {
        actions.push({ label: "신고", icon: ICONS.report, danger: true, handler: () => reportMessage(msg) });
      }
    }
    return actions;
  }
}

function addReaction(msgId, emoji) {
  const reactUid = isAdmin ? "admin" : myUid;
  const key = `${reactUid}_${emoji.codePointAt(0).toString(16)}`;

  // optimistic update — modify local state immediately
  const msg = messages.find((m) => m.id === msgId);
  if (msg) {
    if (!msg.reactions) msg.reactions = {};
    if (msg.reactions[key]) {
      delete msg.reactions[key];
    } else {
      msg.reactions[key] = emoji;
    }
    skipNextScroll = true;
    render();
  }

  // then sync to backend
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

function showEmojiPicker(e, msg, bubbleRect) {
  document.querySelector(".emoji-picker-wrap")?.remove();

  const wrap = document.createElement("div");
  wrap.className = "emoji-picker-wrap";

  const picker = document.createElement("emoji-picker");
  picker.setAttribute("locale", "ko");
  picker.setAttribute("data-source", "https://cdn.jsdelivr.net/npm/emoji-picker-element-data/ko/cldr/data.json");
  picker.addEventListener("emoji-click", (ev) => {
    addReaction(msg.id, ev.detail.unicode);
    wrap.remove();
  });

  wrap.appendChild(picker);
  document.body.appendChild(wrap);

  // position based on the bubble's location
  const pickerH = 320;
  const pickerW = 300;
  const rect = bubbleRect || (e.target && e.target.getBoundingClientRect()) || { top: window.innerHeight / 2, left: window.innerWidth / 2, bottom: window.innerHeight / 2 };

  let top = rect.top - pickerH - 8;
  if (top < 10) top = rect.bottom + 8;
  if (top + pickerH > window.innerHeight - 10) top = window.innerHeight - pickerH - 10;
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
  bar.innerHTML = `<svg class="reply-bar-icon" viewBox="0 0 24 24" width="14" height="14"><path d="M9 4l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h14a4 4 0 0 1 4 4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="reply-bar-text">${preview}</span><button class="reply-bar-close">✕</button>`;
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
  const hasPetitioned = localStorage.getItem("petitionSent") === myUid;

  if (blocked) {
    if (hasPetitioned) {
      // already sent petition, fully disabled
      input.disabled = true;
      input.placeholder = "차단된 사용자입니다";
      sendBtn.hidden = true;
      document.querySelector(".input-wrap")?.classList.add("blocked-mode");
      document.querySelector(".input-wrap")?.classList.remove("dm-mode");
    } else {
      // allow one DM petition
      input.disabled = false;
      input.placeholder = "울어봐빌어도좋곸ㅋㅋㅋ (기회1회)";
      document.querySelector(".input-wrap")?.classList.add("blocked-mode");
      document.querySelector(".input-wrap")?.classList.remove("dm-mode");
      toggleSend();
    }
  } else {
    input.disabled = false;
    input.placeholder = isAdmin ? "말조심" : "친하게 지내";
    document.querySelector(".input-wrap")?.classList.remove("dm-mode");
    document.querySelector(".input-wrap")?.classList.remove("blocked-mode");
    toggleSend();
  }
  return blocked && hasPetitioned;
}

/* rate limiter: max 5 messages per 10 seconds (non-admin only) */
const RATE_LIMIT = 5;
const RATE_WINDOW = 10000;
let sendTimestamps = [];

function isRateLimited() {
  if (isAdmin) return false;
  const now = Date.now();
  sendTimestamps = sendTimestamps.filter((t) => now - t < RATE_WINDOW);
  return sendTimestamps.length >= RATE_LIMIT;
}

async function send() {
  const text = input.value.trim();
  if (!text && !pendingPhoto || !myUid) return;

  // blocked user petition: send one DM then lock
  const isBlocked = !isAdmin && blockedUids.has(myUid);
  const hasPetitioned = localStorage.getItem("petitionSent") === myUid;
  if (isBlocked && hasPetitioned) {
    banner("차단되어 메시지를 보낼 수 없습니다");
    return;
  }
  if (isBlocked && !hasPetitioned) {
    // send as DM petition with the blocked reason quoted
    const blockEntry = blockedList.find((b) => b.uid === myUid);
    const reason = blockEntry && blockEntry.reason ? `\n[차단 사유: "${blockEntry.reason}"]` : "";
    await sendDm({ uid: myUid, nick: myNick, text: `[이의 제기] ${text}${reason}`, image: pendingPhoto || undefined });
    localStorage.setItem("petitionSent", myUid);
    input.value = "";
    input.style.height = "auto";
    pendingPhoto = null;
    removePhotoPreview();
    checkIfBlocked();
    banner("이의 제기가 전송되었습니다", "#ff3b30");
    return;
  }

  if (checkIfBlocked()) {
    banner("차단되어 메시지를 보낼 수 없습니다");
    return;
  }
  if (isRateLimited()) {
    banner("메시지를 너무 빠르게 보내고 있습니다. 잠시 후 다시 시도해주세요.");
    return;
  }
  input.value = "";
  input.style.height = "auto";
  toggleSend();
  const nick = isAdmin ? "관리자" : myNick;
  const sendUid = isAdmin ? "admin" : myUid;
  const msgData = { uid: sendUid, nick, text, is_admin: isAdmin };
  let photoData = null;
  if (pendingPhoto) {
    photoData = pendingPhoto;
    pendingPhoto = null;
    removePhotoPreview();
  }
  if (replyingTo) { msgData.replyTo = replyingTo.id; }
  clearReply();
  try {
    if (dmMode && !isAdmin) {
      await sendDm({ uid: sendUid, nick, text, image: photoData });
      dmMode = false;
      updateDmUI();
      banner("찍이에게 전송됨", "#9b59b6");
    } else {
      // save photo to gallery first, then reference it in the message
      if (photoData) {
        const galleryId = await saveToGallery(photoData);
        msgData.galleryId = galleryId;
      }
      await sendMessage(msgData);
    }
    sendTimestamps.push(Date.now());
  }
  catch (e) { console.error("send failed", e); banner("전송 실패"); }
}

input.addEventListener("input", () => {
  toggleSend();
  // auto-resize textarea
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 80) + "px";
});
input.addEventListener("keydown", (e) => {
  // on mobile (touch devices), Enter adds a new line; on desktop, Enter sends
  const isMobile = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (e.key === "Enter" && !e.isComposing && !e.shiftKey && !isMobile) { e.preventDefault(); send(); }
});
sendBtn.addEventListener("click", send);
sendBtn.addEventListener("touchend", (e) => { e.preventDefault(); send(); });

/* ============================================================
   PHOTO UPLOAD
   ============================================================ */

function showFullImage(src, meta) {
  const overlay = document.createElement("div");
  overlay.className = "img-overlay";
  const img = document.createElement("img");
  img.src = src;
  overlay.appendChild(img);

  // show caption and date if provided
  if (meta) {
    const info = document.createElement("div");
    info.className = "img-overlay-info";
    let html = "";
    if (meta.caption) html += `<div class="img-overlay-caption">${meta.caption}</div>`;
    if (meta.date) {
      const d = new Date(meta.date);
      const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
      html += `<button class="img-overlay-date">${dateStr} →</button>`;
    }
    info.innerHTML = html;
    overlay.appendChild(info);

    // date tap → navigate to message
    const dateBtn = info.querySelector(".img-overlay-date");
    if (dateBtn && meta.msgId) {
      dateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        overlay.remove();
        // close gallery if open
        document.querySelector(".gallery-panel")?.remove();
        scrollToMessage(meta.msgId);
      });
    }
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

/* ============================================================
   LINK PREVIEW
   ============================================================ */
const previewCache = {};

/* ---- Native embeds ---- */
function embedTwitter(url, bubble) {
  const tweetId = url.match(/status\/(\d+)/)?.[1];
  if (!tweetId) return;

  // hide the link text
  const link = bubble.querySelector(`.bubble-link[href="${url}"]`) || bubble.querySelector(`.bubble-link`);
  if (link) link.style.display = "none";

  const container = document.createElement("div");
  container.className = "embed-twitter";
  container.style.minHeight = "80px";
  bubble.appendChild(container);

  // load Twitter widget script if not already loaded
  function renderTweet() {
    if (window.twttr?.widgets?.createTweet) {
      window.twttr.widgets.createTweet(tweetId, container, {
        theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        conversation: "none",
        width: 320,
      });
    }
  }

  if (window.twttr?.widgets) {
    renderTweet();
  } else {
    if (!document.getElementById("twitter-wjs")) {
      const script = document.createElement("script");
      script.id = "twitter-wjs";
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      document.body.appendChild(script);
    }
    (window.twttr = window.twttr || { _e: [] })._e.push(renderTweet);
  }
}

function embedInstagram(url, bubble) {
  // hide the link text
  const link = bubble.querySelector(`.bubble-link[href="${url}"]`) || bubble.querySelector(`.bubble-link`);
  if (link) link.style.display = "none";

  const container = document.createElement("div");
  container.className = "embed-instagram";
  container.style.maxWidth = "320px";
  container.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14" style="max-width:320px;width:100%;margin:0;border:0;border-radius:12px;background:#f4f4f4;"></blockquote>`;
  bubble.appendChild(container);

  // load Instagram embed script if not already loaded
  function processEmbeds() {
    if (window.instgrm?.Embeds?.process) {
      window.instgrm.Embeds.process();
    }
  }

  if (window.instgrm) {
    processEmbeds();
  } else if (!document.getElementById("insta-embed-js")) {
    const script = document.createElement("script");
    script.id = "insta-embed-js";
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    script.onload = processEmbeds;
    document.body.appendChild(script);
  } else {
    setTimeout(processEmbeds, 1000);
  }
}

async function fetchLinkPreview(url, bubble) {
  // check cache first
  if (previewCache[url]) {
    renderPreviewCard(previewCache[url], bubble);
    return;
  }

  try {
    const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.title && !data.image) return;
    previewCache[url] = data;
    renderPreviewCard(data, bubble);
  } catch (e) {
    // silently fail — no preview
  }
}

function renderPreviewCard(data, bubble) {
  const card = document.createElement("a");
  card.className = "link-preview-card";
  card.href = data.url;
  card.target = "_blank";
  card.rel = "noopener";

  let html = "";
  if (data.video) {
    // render inline video player
    html += `<video class="link-preview-video" src="${data.video}" poster="${data.image || ""}" controls playsinline preload="metadata"></video>`;
    // prevent card link from triggering when interacting with video
    card.addEventListener("click", (e) => {
      if (e.target.tagName === "VIDEO") e.preventDefault();
    });
  } else if (data.image) {
    html += `<img class="link-preview-img" src="${data.image}" alt="" />`;
  }
  html += `<div class="link-preview-body">`;
  if (data.siteName) html += `<div class="link-preview-site">${data.siteName}</div>`;
  if (data.title) html += `<div class="link-preview-title">${data.title}</div>`;
  if (data.description) html += `<div class="link-preview-desc">${data.description.slice(0, 100)}${data.description.length > 100 ? "…" : ""}</div>`;
  html += `</div>`;

  card.innerHTML = html;

  // hide the specific link that this preview replaces
  bubble.querySelectorAll(".bubble-link").forEach((link) => {
    if (link.href === data.url || link.textContent === data.url) {
      link.style.display = "none";
    }
  });

  bubble.appendChild(card);
}

function scrollToMessage(msgId) {
  const el = document.getElementById(`msg-${msgId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

const photoBtn = $("#photoBtn");
const photoInput = $("#photoInput");
let pendingPhoto = null; // stores the compressed data URL until user sends
let dmMode = false; // DM to admin mode

photoBtn.addEventListener("click", (e) => {
  if (isAdmin) {
    showAdminPlusMenu(e);
  } else {
    // blocked users who already petitioned can't use + menu
    const isBlocked = blockedUids.has(myUid);
    const hasPetitioned = localStorage.getItem("petitionSent") === myUid;
    if (isBlocked && hasPetitioned) return;
    showPlusMenu(e);
  }
});

function showAdminPlusMenu(e) {
  document.querySelector(".plus-menu")?.remove();

  const menu = document.createElement("div");
  menu.className = "plus-menu";
  menu.innerHTML = `
    <button class="plus-menu-item" data-action="photo"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg> 사진 보내기</button>
    <button class="plus-menu-item" data-action="notice"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.73 21a2 2 0 0 1-3.46 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> 공지 등록</button>
  `;

  menu.querySelector('[data-action="photo"]').addEventListener("click", () => { menu.remove(); photoInput.click(); });
  menu.querySelector('[data-action="notice"]').addEventListener("click", () => { menu.remove(); showNoticeInput(); });

  const rect = photoBtn.getBoundingClientRect();
  menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  menu.style.left = `${rect.left}px`;

  document.body.appendChild(menu);
  setTimeout(() => {
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", close); } };
    document.addEventListener("click", close);
  }, 10);
}

function showNoticeInput() {
  const text = prompt("공지 내용:");
  if (text && text.trim()) {
    setNoticeBanner(text.trim());
  }
}

let currentNotice = "";

function setNoticeBanner(text) {
  currentNotice = text;
  localStorage.removeItem("noticeDismissed");
  doSetNotice(text);
  renderNoticeBanner();
}

function renderNoticeBanner() {
  document.querySelector(".notice-banner")?.remove();
  if (!currentNotice) return;
  // don't show if user dismissed it
  if (localStorage.getItem("noticeDismissed") === currentNotice) return;

  const banner = document.createElement("div");
  banner.className = "notice-banner";
  banner.innerHTML = `
    <span class="notice-banner-icon"><svg viewBox="0 0 32 32" width="16" height="16" fill="currentColor"><path d="M5.063,19.369l0.521,4.602c0.007,0.067,0.021,0.133,0.042,0.197c0.412,1.266,1.591,2.072,2.855,2.072c0.308,0,0.619-0.048,0.927-0.148c1.572-0.512,2.436-2.208,1.924-3.781l-0.83-2.551h0.261l7.789,3.895c0.142,0.07,0.294,0.105,0.447,0.105c0.183,0,0.365-0.05,0.525-0.149C19.82,23.429,20,23.107,20,22.76v-4.142c1.721-0.447,3-2,3-3.858s-1.279-3.411-3-3.858V6.76c0-0.347-0.18-0.668-0.475-0.851c-0.295-0.183-0.663-0.199-0.973-0.044L10.764,9.76H7c-2.757,0-5,2.243-5,5C2,16.831,3.265,18.611,5.063,19.369z M9.43,22.93c0.171,0.524-0.116,1.089-0.641,1.26c-0.499,0.163-1.032-0.089-1.231-0.562L7.119,19.76h1.279L9.43,22.93z M21,14.76c0,0.737-0.405,1.375-1,1.722v-3.443C20.595,13.385,21,14.023,21,14.76z M18,21.142l-6-3v-6.764l6-3V21.142z M7,11.76h3v6H7c-1.654,0-3-1.346-3-3S5.346,11.76,7,11.76z"/><path d="M27,15.76h2c0.553,0,1-0.448,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.448-1,1S26.447,15.76,27,15.76z"/><path d="M27,10.467c0.256,0,0.512-0.098,0.707-0.293l1.414-1.414c0.391-0.391,0.391-1.023,0-1.414s-1.023-0.391-1.414,0L26.293,8.76c-0.391,0.391-0.391,1.023,0,1.414C26.488,10.37,26.744,10.467,27,10.467z"/><path d="M27.707,22.174c0.195,0.195,0.451,0.293,0.707,0.293s0.512-0.098,0.707-0.293c0.391-0.391,0.391-1.023,0-1.414l-1.414-1.414c-0.391-0.391-1.023-0.391-1.414,0s-0.391,1.023,0,1.414L27.707,22.174z"/></svg></span>
    <span class="notice-banner-text">${currentNotice}</span>
    <button class="notice-banner-close">✕</button>
  `;

  banner.querySelector(".notice-banner-close").addEventListener("click", () => {
    localStorage.setItem("noticeDismissed", currentNotice);
    banner.remove();
  });

  // insert after header as a floating element
  document.querySelector(".chat-header").insertAdjacentElement("afterend", banner);
}

function showPlusMenu(e) {
  document.querySelector(".plus-menu")?.remove();

  const menu = document.createElement("div");
  menu.className = "plus-menu";
  menu.innerHTML = `
    <button class="plus-menu-item" data-action="dm"><svg viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ${dmMode ? "일반 메시지로 전환" : "비밀 메세지"}</button>
    <button class="plus-menu-item" data-action="photo"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg> 사진 보내기</button>
  `;

  menu.querySelector('[data-action="photo"]').addEventListener("click", () => {
    menu.remove();
    photoInput.click();
  });

  menu.querySelector('[data-action="dm"]').addEventListener("click", () => {
    menu.remove();
    dmMode = !dmMode;
    updateDmUI();
  });

  // position above the + button
  const rect = photoBtn.getBoundingClientRect();
  menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  menu.style.left = `${rect.left}px`;

  document.body.appendChild(menu);

  setTimeout(() => {
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", close); } };
    document.addEventListener("click", close);
  }, 10);
}

function updateDmUI() {
  if (dmMode) {
    input.placeholder = "찍이에게 보내기";
    document.querySelector(".input-wrap").classList.add("dm-mode");
  } else {
    input.placeholder = "친하게 지내";
    document.querySelector(".input-wrap").classList.remove("dm-mode");
  }
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  if (!file) return;
  photoInput.value = "";

  // compress and convert to base64 (skip for GIFs to preserve animation)
  let dataUrl;
  const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
  if (isGif) {
    dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  } else {
    dataUrl = await compressImage(file, 800, 0.7);
  }

  // check size limit (50MB max for Supabase Storage)
  if (dataUrl.length > 50 * 1024 * 1024) {
    banner("파일이 너무 큽니다 (최대 50MB)");
    return;
  }

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
   GALLERY VIEW
   ============================================================ */
function showGallery() {
  document.querySelector(".gallery-panel")?.remove();

  // group gallery items by date (KST)
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
      // find the message that references this gallery item
      const msg = allMessages.find((m) => m.galleryId === galleryId);
      const meta = msg ? { caption: msg.text || "", date: msg.createdAt, msgId: msg.id } : null;
      showFullImage(img.src, meta);
    });
  });

  document.body.appendChild(panel);
}

/* ============================================================
   LINKS PANEL — shows all shared links with previews
   ============================================================ */
function showLinks() {
  document.querySelector(".links-panel")?.remove();

  // extract all URLs from messages
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
  const uniqueLinks = [...seen.values()].reverse(); // newest first

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
      card.innerHTML = `<div class="links-card-url">${link.url}</div>`;
      card.addEventListener("click", () => {
        panel.remove();
        scrollToMessage(link.msgId);
      });
      listEl.appendChild(card);

      // try to fetch preview
      try {
        const res = await fetch(`/api/preview?url=${encodeURIComponent(link.url)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.title || data.image) {
            let html = "";
            if (data.image) html += `<img class="links-card-img" src="${data.image}" />`;
            html += `<div class="links-card-body">`;
            if (data.siteName) html += `<div class="links-card-site">${data.siteName}</div>`;
            if (data.title) html += `<div class="links-card-title">${data.title}</div>`;
            html += `</div>`;
            card.innerHTML = html;
          }
        }
      } catch (e) { /* keep URL fallback */ }
    });
  }
}

/* ============================================================
   ADMIN TOGGLE — long press header avatar to toggle admin mode
   ============================================================ */
function refilterMessages() {
  if (!isAdmin) {
    messages = allMessages.filter((m) => !m.report);
  } else {
    const merged = [...allMessages, ...dmMessages.map((d) => ({ ...d, dm: true }))];
    merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    messages = merged;
  }
}

(function() {
  const avatar = document.querySelector(".chat-header");
  if (!avatar) return;
  let pressTimer = null;

  avatar.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    pressTimer = setTimeout(async () => {
      pressTimer = null;
      if (isAdmin) {
        isAdmin = false;
        localStorage.setItem("isAdmin", "false");
        localStorage.removeItem("ap");
        setAdminPasscode(null);
        checkIfBlocked();
        refilterMessages();
        render();
        banner("관리자 모드 해제");
      } else {
        const pass = prompt("관리자 비밀번호:");
        if (pass) {
          const valid = await verifyAdmin(pass);
          if (valid) {
            setAdminPasscode(pass);
            isAdmin = true;
            localStorage.setItem("isAdmin", "true");
            localStorage.setItem("ap", btoa(pass));
            checkIfBlocked();
            refilterMessages();
            render();
            banner("관리자 모드 활성화");
          } else {
            banner("비밀번호가 틀렸습니다");
          }
        }
      }
    }, 800);
  });

  avatar.addEventListener("pointerup", () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
  avatar.addEventListener("pointerleave", () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
})();

/* ============================================================
   ADMIN MENU (3-dot button) — blocked users panel
   ============================================================ */
/* ============================================================
   NOTICE / USER GUIDE
   ============================================================ */
document.querySelector(".hdr-notice")?.addEventListener("click", () => {
  showNoticePanel();
});

function showNoticePanel() {
  document.querySelector(".notice-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "notice-panel";

  panel.innerHTML = `
    <div class="notice-panel-content">
      <div class="notice-panel-header">
        <h3><svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-2px"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 16v-4M12 8h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> 공지사항</h3>
        <button class="notice-panel-close">✕</button>
      </div>
      <div class="notice-panel-body">
        <div class="notice-section">
          <h4>이용 안내</h4>
          <ul>
            <li>꾹 눌러서 리액션/답장/신고 가능</li>
            <li>본인이 쓴 메세지 삭제 가능, 답장 달렸을 시 삭제된 메세지로 표시</li>
            <li>신고 철회 가능, 신고자에게만 신고 메세지 플래그</li>
            <li>+ 메뉴: 사진 보내기 / 비밀 메세지</li>
            <li>비밀 메세지는 찍이한테만 보이고 보낸 사람한테도 안보임</li>
            <li>우측 상단 메뉴에 설정/갤러리/링크</li>
          </ul>
        </div>
        <div class="notice-section">
          <h4>규칙</h4>
          <ul>
            <li>호모:순덕 비율 알잘딱깔센</li>
            <li>빡치는 메세지 있을경우 플 늘리지 말고 신고하면 다지워줌</li>
            <li>차단당한거 억울하면 탄원서 제출가능 (기회1번)</li>
          </ul>
        </div>
      </div>
    </div>
  `;

  panel.querySelector(".notice-panel-close").addEventListener("click", () => panel.remove());
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });

  document.body.appendChild(panel);
}

/* ============================================================
   SEARCH — find messages with navigation arrows
   ============================================================ */
let searchResults = [];
let searchIndex = -1;

document.querySelector(".hdr-search")?.addEventListener("click", () => {
  toggleSearchBar();
});

function toggleSearchBar() {
  const existing = document.querySelector(".search-bar");
  if (existing) { closeSearchBar(); return; }

  const bar = document.createElement("div");
  bar.className = "search-bar";
  bar.innerHTML = `
    <input class="search-input" type="text" placeholder="검색..." autocomplete="off" />
    <button class="search-nav-btn search-prev" aria-label="Previous">
      <svg viewBox="0 0 24 24" width="24" height="24"><path d="M18 15l-6-6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="search-nav-btn search-next" aria-label="Next">
      <svg viewBox="0 0 24 24" width="24" height="24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="search-close-btn">✕</button>
  `;

  document.querySelector(".chat-header").insertAdjacentElement("afterend", bar);

  const searchInput = bar.querySelector(".search-input");
  
  const prevBtn = bar.querySelector(".search-prev");
  const nextBtn = bar.querySelector(".search-next");
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  searchInput.focus();

  let debounceTimer;
  searchInput.addEventListener("input", () => {
    // clear highlights while typing (but don't search yet)
    document.querySelectorAll(".search-match").forEach((el) => {
      const parent = el.parentNode;
      el.replaceWith(el.textContent);
      if (parent) parent.normalize();
    });
    searchResults = [];
    searchIndex = -1;
    const bar = document.querySelector(".search-bar");
    if (bar) {
      bar.querySelector(".search-prev").disabled = true;
      bar.querySelector(".search-next").disabled = true;
    }
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (searchResults.length === 0) {
        performSearch(searchInput.value.trim());
      } else {
        navigateSearch(-1); // next older match
      }
    }
    if (e.key === "Escape") closeSearchBar();
  });

  prevBtn.addEventListener("click", () => navigateSearch(-1));
  nextBtn.addEventListener("click", () => navigateSearch(1));
  bar.querySelector(".search-close-btn").addEventListener("click", closeSearchBar);
}

function closeSearchBar() {
  document.querySelector(".search-bar")?.remove();
  // clear highlights
  document.querySelectorAll(".search-match").forEach((el) => {
    const parent = el.parentNode;
    el.replaceWith(el.textContent);
    if (parent) parent.normalize();
  });
  searchResults = [];
  searchIndex = -1;
}

async function performSearch(query) {
  // clear previous highlights
  document.querySelectorAll(".search-match").forEach((el) => {
    const parent = el.parentNode;
    el.replaceWith(el.textContent);
    if (parent) parent.normalize();
  });
  searchResults = [];
  searchIndex = -1;

  if (!query) return;

  // search raw message data (works even for hidden link text)
  const queryLower = query.toLowerCase();
  messages.forEach((m) => {
    if (m.text && m.text.toLowerCase().includes(queryLower)) {
      const row = document.getElementById(`msg-${m.id}`);
      if (row) {
        const bubble = row.querySelector(".bubble");
        if (bubble) {
          highlightTextInBubble(bubble, query);
          searchResults.push(row);
        }
      }
    }
  });

  // if no local results, try server-side search
  if (searchResults.length === 0 && !IS_MOCK) {
    try {
      const serverResults = await searchMessages(query);
      if (serverResults.length > 0) {
        // load these messages into the view
        const newMsgs = serverResults.filter((m) => !allMessages.find((a) => a.id === m.id));
        if (newMsgs.length > 0) {
          allMessages = [...newMsgs, ...allMessages];
          allMessages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          refilterMessages();
          render();
          // re-search locally now that messages are loaded
          messages.forEach((m) => {
            if (m.text && m.text.toLowerCase().includes(queryLower)) {
              const row = document.getElementById(`msg-${m.id}`);
              if (row) {
                const bubble = row.querySelector(".bubble");
                if (bubble) {
                  highlightTextInBubble(bubble, query);
                  searchResults.push(row);
                }
              }
            }
          });
        }
      }
    } catch (e) { /* server search failed, stay with no results */ }
  }

  // results are in DOM order (old → new), start at the last one (newest)
  if (searchResults.length > 0) {
    searchIndex = searchResults.length - 1;
    highlightCurrent();
  } else {
    banner("검색 결과가 없습니다", "#666");
  }
}

function highlightTextInBubble(bubble, query) {
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "gi");
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((node) => {
    if (regex.test(node.textContent)) {
      const span = document.createElement("span");
      span.innerHTML = node.textContent.replace(regex, '<mark class="search-match">$1</mark>');
      node.replaceWith(span);
    }
  });
}

function navigateSearch(direction) {
  if (searchResults.length === 0) return;
  // remove current active marker
  searchResults[searchIndex]?.querySelector(".search-active")?.classList.remove("search-active");

  // direction: -1 = up arrow = older (lower index), +1 = down arrow = newer (higher index)
  searchIndex += direction;
  if (searchIndex >= searchResults.length) searchIndex = searchResults.length - 1;
  if (searchIndex < 0) searchIndex = 0;

  highlightCurrent();
}

function highlightCurrent() {
  const row = searchResults[searchIndex];
  if (!row) return;
  // mark current match as active
  const match = row.querySelector(".search-match");
  if (match) match.classList.add("search-active");
  row.scrollIntoView({ behavior: "smooth", block: "center" });

  // update arrow button states
  // up (prev/older) disabled at index 0, down (next/newer) disabled at last index
  const bar = document.querySelector(".search-bar");
  if (bar) {
    const prevBtn = bar.querySelector(".search-prev");
    const nextBtn = bar.querySelector(".search-next");
    prevBtn.disabled = searchIndex <= 0;
    nextBtn.disabled = searchIndex >= searchResults.length - 1;
  }
}

document.querySelector(".hdr-menu")?.addEventListener("click", (e) => {
  showHeaderMenu(e);
});

function showHeaderMenu(e) {
  document.querySelector(".header-menu")?.remove();

  const menu = document.createElement("div");
  menu.className = "header-menu";
  menu.innerHTML = `
    <button class="header-menu-item" data-action="settings"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="2"/></svg> 설정</button>
    <button class="header-menu-item" data-action="gallery"><svg viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> 갤러리</button>
    <button class="header-menu-item" data-action="links"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> 링크</button>
  `;

  menu.querySelector('[data-action="settings"]').addEventListener("click", () => { menu.remove(); showSettingsPanel(); });
  menu.querySelector('[data-action="gallery"]').addEventListener("click", () => { menu.remove(); showGallery(); });
  menu.querySelector('[data-action="links"]').addEventListener("click", () => { menu.remove(); showLinks(); });

  // position below the menu button
  const rect = document.querySelector(".hdr-menu").getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(menu);

  setTimeout(() => {
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", close); } };
    document.addEventListener("click", close);
  }, 10);
}

function showSettingsPanel() {
  document.querySelector(".settings-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "settings-panel";

  const currentSize = parseInt(localStorage.getItem("fontSize") || "17");

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
          <span class="settings-label">테마</span>
          <div class="settings-theme-control">
            <button class="settings-theme-btn" data-theme="light">라이트</button>
            <button class="settings-theme-btn" data-theme="dark">다크</button>
          </div>
        </div>
        <div class="settings-divider"></div>
        ${isAdmin ? '<button class="settings-item settings-blocked-btn">차단된 사용자 관리</button>' : ''}
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

  // theme controls
  panel.querySelectorAll(".settings-theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.documentElement.dataset.theme = btn.dataset.theme;
      localStorage.setItem("theme", btn.dataset.theme);
    });
  });

  // blocked users (admin only)
  const blockedBtn = panel.querySelector(".settings-blocked-btn");
  if (blockedBtn) {
    blockedBtn.addEventListener("click", () => { panel.remove(); showBlockedPanel(); });
  }

  document.body.appendChild(panel);
}

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
      await doUnblock(uid);
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
  // no gate — start directly, isAdmin restored from localStorage
  startChat();
}

/* ---------- start ---------- */
let started = false;
function startChat() {
  if (started) return;
  started = true;
  checkIfBlocked();
  // force scroll to bottom for first 5 seconds while data loads
  setTimeout(() => { initialLoad = false; }, 5000);
  subscribeBlocked((list) => { blockedList = list; blockedUids = new Set(list.map(b => b.uid)); checkIfBlocked(); refilterMessages(); render(); });
  subscribe((list) => {
    allMessages = list;
    // filter out report messages for display
    if (!isAdmin) {
      messages = list.filter((m) => !m.report);
    } else {
      // admin: merge DMs into message list sorted by time
      const merged = [...list, ...dmMessages.map((d) => ({ ...d, dm: true }))];
      merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      messages = merged;
    }
    debouncedRender();
  });
  // subscribe to DMs (admin sees them in the chat)
  subscribeDm((list) => {
    dmMessages = list;
    // re-merge for admin view
    if (isAdmin) {
      const merged = [...allMessages, ...dmMessages.map((d) => ({ ...d, dm: true }))];
      merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      messages = merged;
    }
    render();
  });
  // subscribe to gallery
  subscribeGallery((list) => { galleryItems = list; render(); });
  // subscribe to notice
  subscribeNotice((text) => {
    // if notice changed, reset dismiss status
    if (text && text !== currentNotice) {
      localStorage.removeItem("noticeDismissed");
    }
    currentNotice = text;
    renderNoticeBanner();
  });
  toggleSend();
  renderNoticeBanner();

  // load more messages when scrolling to top
  let loadingMore = false;
  messagesEl.addEventListener("scroll", async () => {
    if (messagesEl.scrollTop < 50 && !loadingMore && messages.length > 0) {
      const oldest = messages.find((m) => m.createdAt);
      if (!oldest || !oldest.createdAt) return;
      loadingMore = true;
      const older = await loadMoreMessages(oldest.createdAt.toISOString());
      if (older.length > 0) {
        const prevHeight = messagesEl.scrollHeight;
        allMessages = [...older, ...allMessages];
        refilterMessages();
        render();
        // maintain scroll position
        messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight;
      }
      loadingMore = false;
    }
  });
}

/* small non-blocking error banner */
function banner(msg, color) {
  let b = $("#banner");
  if (!b) {
    b = document.createElement("div");
    b.id = "banner";
    b.className = "banner";
    document.body.appendChild(b);
  }
  b.textContent = msg;
  b.style.background = color || "#ff3b30";
  b.style.display = "block";
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => { b.style.display = "none"; }, 3000);
}
