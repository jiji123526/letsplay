/* ============================================================
   iMessage UI  —  realtime chat (backend-agnostic)
   ------------------------------------------------------------
   This file is pure UI/UX. It talks only to ./backend.js, which
   is either the local mock (localStorage, no Firebase) or real
   Firebase — controlled by USE_MOCK in firebase-config.js.

   Message object: { id, uid, nick, text, is_admin, createdAt:Date }
   Renders blue "sent" when uid === my uid, else gray "recv".
   ============================================================ */

import { initAuth, subscribe, sendMessage, removeMessage, softDeleteMessage, editMessage, addReaction as addReactionBackend, removeReaction as removeReactionBackend, blockUser, getBlockedUsers, subscribeBlocked, sendDm, removeDm, subscribeDm, saveToGallery, subscribeGallery, removeFromGallery, setNotice, subscribeNotice, searchMessages, loadMoreMessages, setChannel, getChannelPasscode, subscribeLiveStatus, initBroadcast, onEditBroadcast, onEmojiBroadcast, broadcastEdit, broadcastEmoji, IS_MOCK } from "./backend/index.js";
import { verifyAdmin, setAdminPasscode, getAdminPasscode, adminDeleteMessage, adminDeleteMessages, adminUpdateMessage, adminBlock, adminUnblock, adminDeleteDm, adminDeleteGallery, adminSetNotice, adminSetColor, adminGetColor, adminSetPasscode, adminGetPasscode, adminStartLive, adminEndLive } from "./admin/api.js";
import { embedTwitter, embedInstagram, fetchLinkPreview } from "./modules/embeds.js";
import { compressImage, getImageDimensions, showFullImage as showFullImageBase } from "./modules/photo.js";
import { showGallery as showGalleryBase } from "./modules/gallery.js";
import { showLinks as showLinksBase } from "./modules/links-panel.js";
import { initSearch, configureSearch, restoreSearchHighlights, highlightTextInBubble, closeSearchBar } from "./modules/search.js";
import { initLiveMode, enterLiveMode, exitLiveMode, showLivePopup, showLiveBanner, showLiveExitBanner, showLiveEndedPopup, removeLiveBanner, spawnEmoji, removeEmojiBar, showEmojiBar, updateEmojiBarPresets } from "./modules/live.js";
import { generateFingerprint } from "./modules/fingerprint.js";
import { channels } from "../config.js";
import "emoji-picker-element";

const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages");

/* SHA-256 hash utility for passcode comparison */
async function hashString(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* restore saved settings */
(function() {
  const savedSize = localStorage.getItem("fontSize");
  if (savedSize) document.documentElement.style.setProperty("--bubble-font-size", `${savedSize}px`);
  // theme always follows system
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    document.documentElement.dataset.theme = e.matches ? "dark" : "light";
  });
  // restore saved bubble color (applied after channel detection below)
})();

/* ---------- local state ---------- */
let myUid   = null;
let myNick  = "";          // derived from uid on sign-in (anonymous tag)
const myFingerprint = generateFingerprint();
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
let hasScrolledInitial = false;
let userInteracted = false;
let liveActive = localStorage.getItem(`liveActive_${new URLSearchParams(window.location.search).get("ch") || window.location.pathname.match(/^\/ch\/([^/]+)/)?.[1] || "main"}`) === "true";
let inLiveMode = localStorage.getItem(`inLiveMode_${new URLSearchParams(window.location.search).get("ch") || window.location.pathname.match(/^\/ch\/([^/]+)/)?.[1] || "main"}`) === "true";
let reportedMsgIds = new Set(JSON.parse(localStorage.getItem("reportedMsgIds") || "[]"));

/* debounced render — batches rapid updates (reactions, etc.) into one render */
let renderTimer = null;
let skipNextScroll = false;
let prevMessageIds = [];
const embedCache = new Map(); // msgId → embed DOM element

function debouncedRender() {
  if (renderTimer) cancelAnimationFrame(renderTimer);
  renderTimer = requestAnimationFrame(() => { renderTimer = null; skipNextScroll = true; render(); });
}

// check if only reactions changed (same messages, same order)
function canPatchReactions(newList) {
  if (prevMessageIds.length === 0) return false;
  const newIds = messages.map(m => m.id);
  if (newIds.length !== prevMessageIds.length) return false;
  for (let i = 0; i < newIds.length; i++) {
    if (newIds[i] !== prevMessageIds[i]) return false;
  }
  // also check that text/deleted/image hasn't changed (only reactions differ)
  for (const m of messages) {
    const row = document.getElementById(`msg-${m.id}`);
    if (!row) return false;
  }
  return true;
}

// update only reaction badges in the DOM without full re-render
function patchReactions() {
  const reactUid = isAdmin ? "admin" : myUid;
  messages.forEach((m) => {
    const row = document.getElementById(`msg-${m.id}`);
    if (!row) return;
    const existingBadge = row.querySelector(".reaction-badge");
    const reactions = m.reactions || {};
    const keys = Object.keys(reactions);

    if (keys.length === 0) {
      if (existingBadge) existingBadge.remove();
      return;
    }

    // group by emoji
    const counts = {};
    const emojiOrder = [];
    Object.entries(reactions).forEach(([key, emoji]) => {
      if (!counts[emoji]) { counts[emoji] = { count: 0, mine: false }; emojiOrder.push(emoji); }
      counts[emoji].count++;
      if (key.startsWith(`${reactUid}_`)) counts[emoji].mine = true;
    });
    emojiOrder.sort();

    // build new badge content
    const side = row.classList.contains("sent") ? "sent" : "recv";
    let badge = existingBadge;
    if (!badge) {
      badge = document.createElement("div");
      badge.className = `reaction-badge ${side}`;
      const col = row.querySelector(".bubble-col");
      if (col) col.appendChild(badge);
    }
    badge.innerHTML = "";
    emojiOrder.forEach((emoji) => {
      const data = counts[emoji];
      const pill = document.createElement("button");
      pill.className = `reaction-pill${data.mine ? " mine" : ""}`;
      pill.innerHTML = `${emoji} <span class="reaction-count">${data.count}</span>`;
      pill.addEventListener("click", (e) => { e.stopPropagation(); addReactionBackend(m.id, emoji, reactUid); });
      badge.appendChild(pill);
    });
    // add + button
    const addBtn = document.createElement("button");
    addBtn.className = "reaction-add-btn";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", (e) => { e.stopPropagation(); showEmojiPicker(e, m); });
    badge.appendChild(addBtn);
  });
}

function saveReportedIds() {
  localStorage.setItem("reportedMsgIds", JSON.stringify([...reportedMsgIds]));
}

/* ============================================================
   RENDERING  (your original iMessage logic, driven by live data)
   ============================================================ */
function render() {
  // check if user is near the bottom before re-rendering
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  skipNextScroll = false;

  // save embed elements before clearing DOM
  messagesEl.querySelectorAll(".embed-twitter, .embed-instagram").forEach((el) => {
    const row = el.closest(".row[id]");
    if (row) {
      const msgId = row.id.replace("msg-", "");
      embedCache.set(msgId, el);
      el.remove(); // detach but keep in cache
    }
  });

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
  if (!hasScrolledInitial) {
    hasScrolledInitial = true;
    // defer to next frame so browser finishes layout before we scroll
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      messagesEl.style.visibility = "visible";
    });
  } else if (nearBottom && !initialLoad) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // track message IDs for reaction-only change detection
  // scroll anchor at the bottom
  const anchor = document.createElement("div");
  anchor.className = "scroll-anchor";
  messagesEl.appendChild(anchor);

  prevMessageIds = messages.filter(m => !m.report).map(m => m.id);

  // restore search highlights if search is active
  restoreSearchHighlights(messages);
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
      doBlock(msg.uid, msg.text || "[DM]", msg.fingerprint);
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
      bubble.textContent = "삭제된 채팅입니다";
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
        // reserve space using stored dimensions to prevent layout shift
        if (m.imageW && m.imageH) {
          img.style.aspectRatio = `${m.imageW} / ${m.imageH}`;
          img.style.width = "100%";
        }
        // handle load failure with tap-to-retry
        img.addEventListener("error", () => {
          imgWrap.classList.add("img-failed");
          imgWrap.innerHTML = `<div class="img-placeholder">탭하여 다시 시도</div>`;
          if (m.imageW && m.imageH) {
            imgWrap.style.aspectRatio = `${m.imageW} / ${m.imageH}`;
          }
          imgWrap.addEventListener("click", () => {
            imgWrap.classList.remove("img-failed");
            imgWrap.innerHTML = "";
            const retryImg = document.createElement("img");
            retryImg.className = "bubble-img";
            retryImg.src = imageSrc;
            retryImg.alt = "photo";
            if (m.imageW && m.imageH) {
              retryImg.style.aspectRatio = `${m.imageW} / ${m.imageH}`;
              retryImg.style.width = "100%";
            }
            retryImg.addEventListener("error", () => {
              imgWrap.classList.add("img-failed");
              imgWrap.innerHTML = `<div class="img-placeholder">이미지를 불러올 수 없습니다</div>`;
            });
            imgWrap.appendChild(retryImg);
          }, { once: true });
        });
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
        // gallery item was deleted — show caption if exists, otherwise placeholder
        if (m.text) {
          bubble.textContent = m.text;
        } else {
          bubble.textContent = "삭제된 사진입니다";
          bubble.classList.add("deleted");
        }
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
            if (embedCache.has(m.id)) {
              const link = bubble.querySelector(".bubble-link"); if (link) link.style.display = "none";
              bubble.appendChild(embedCache.get(m.id));
              embedCache.delete(m.id);
            } else { embedTwitter(fullUrl, bubble); }
          } else if (instagramRegex.test(fullUrl)) {
            if (embedCache.has(m.id)) {
              const link = bubble.querySelector(".bubble-link"); if (link) link.style.display = "none";
              bubble.appendChild(embedCache.get(m.id));
              embedCache.delete(m.id);
            } else { embedInstagram(fullUrl, bubble); }
          } else {
            fetchLinkPreview(fullUrl, bubble);
          }
        });
        // clean up whitespace around hidden links to prevent blank lines with pre-wrap
        bubble.querySelectorAll('.bubble-link[style*="display: none"]').forEach((link) => {
          const prev = link.previousSibling;
          const next = link.nextSibling;
          if (prev && prev.nodeType === 3) prev.textContent = prev.textContent.replace(/\n\s*$/, "");
          if (next && next.nodeType === 3) next.textContent = next.textContent.replace(/^\s*\n/, "");
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

/* ---- Set channel from URL (/ch/xxx or ?ch=xxx, default "main") ---- */
const pathMatch = window.location.pathname.match(/^\/ch\/([^/]+)/);
const urlChannel = pathMatch ? pathMatch[1] : (new URLSearchParams(window.location.search).get("ch") || "main");
setChannel(urlChannel);

/* ---- Update header to reflect current channel ---- */
const currentChannelConfig = channels.find(c => c.id === urlChannel) || channels[0];

// passcode is handled by the channel picker before navigation
sessionStorage.removeItem("ch_switching");

document.querySelector(".hdr-name").textContent = currentChannelConfig.name;
document.querySelector(".chat-header").addEventListener("click", (e) => {
  // scroll to top unless tapping avatar or buttons
  if (e.target.closest(".hdr-avatar") || e.target.closest(".hdr-btn")) return;
  messagesEl.scrollTo({ top: 0, behavior: "smooth" });
});
document.querySelector(".hdr-avatar-img").src = currentChannelConfig.profile;
const savedBubbleColor = localStorage.getItem(`bubbleColor_${urlChannel}`);
if (savedBubbleColor) {
  document.documentElement.style.setProperty("--bubble-sent", savedBubbleColor);
} else if (currentChannelConfig.bubble) {
  document.documentElement.style.setProperty("--bubble-sent", currentChannelConfig.bubble);
}
// admin: fetch synced color from server after auth
async function syncAdminColor() {
  if (!isAdmin || IS_MOCK) return;
  try {
    const color = await adminGetColor(urlChannel);
    if (color) {
      localStorage.setItem(`bubbleColor_${urlChannel}`, color);
      document.documentElement.style.setProperty("--bubble-sent", color);
    }
  } catch { /* API unavailable locally */ }
}

/* ---- Channel picker (tap on avatar) ---- */
function showChannelPicker() {
  document.querySelector(".channel-picker")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "channel-picker";
  overlay.innerHTML = `
    <div class="channel-picker-content">
      <div class="channel-picker-grid">
        ${channels.map(ch => `
          <button class="channel-picker-item ${ch.id === urlChannel ? "active" : ""}" data-ch="${ch.id}">
            <img class="channel-picker-profile" src="${ch.profile}" alt="${ch.name}" />
            <span class="channel-picker-name">${ch.name}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelectorAll(".channel-picker-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const ch = btn.dataset.ch;
      if (ch !== urlChannel) {
        const targetChannel = channels.find(c => c.id === ch);
        // check if channel requires a passcode (admins skip)
        if (targetChannel?.passcode && !isAdmin) {
          showPasscodeDialog(targetChannel, () => {
            const url = new URL(window.location);
            if (ch === "main") {
              url.pathname = "/";
              url.searchParams.delete("ch");
            } else {
              url.pathname = `/ch/${ch}`;
              url.searchParams.delete("ch");
            }
            sessionStorage.setItem("ch_switching", "true");
            window.location.href = url.toString();
          });
          overlay.remove();
          return;
        }
        const url = new URL(window.location);
        if (ch === "main") {
          url.pathname = "/";
          url.searchParams.delete("ch");
        } else {
          url.pathname = `/ch/${ch}`;
          url.searchParams.delete("ch");
        }
        sessionStorage.setItem("ch_switching", "true");
        window.location.href = url.toString();
      } else {
        overlay.remove();
      }
    });
  });

  document.body.appendChild(overlay);
}

function showConfirmDialog(title, message, onConfirm) {
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  dialog.innerHTML = `
    <div class="edit-dialog-content">
      <div class="edit-dialog-title">${title}</div>
      <div style="font-size:var(--bubble-font-size, 14px);color:var(--meta);margin-bottom:16px;line-height:1.5;">${message}</div>
      <div class="edit-dialog-buttons">
        <button class="edit-dialog-cancel">취소</button>
        <button class="edit-dialog-save">확인</button>
      </div>
    </div>
  `;
  dialog.querySelector(".edit-dialog-save").addEventListener("click", () => { dialog.remove(); onConfirm(); });
  dialog.querySelector(".edit-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });
  document.body.appendChild(dialog);
}

function showPromptDialog(title, placeholder, onSubmit) {
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  dialog.innerHTML = `
    <div class="edit-dialog-content">
      <div class="edit-dialog-title">${title}</div>
      <input class="notice-edit-title" type="text" placeholder="${placeholder}" />
      <div class="edit-dialog-buttons">
        <button class="edit-dialog-cancel">취소</button>
        <button class="edit-dialog-save">확인</button>
      </div>
    </div>
  `;
  const input = dialog.querySelector("input");
  dialog.querySelector(".edit-dialog-save").addEventListener("click", () => {
    const val = input.value.trim();
    if (val) { dialog.remove(); onSubmit(val); }
  });
  dialog.querySelector(".edit-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });
  document.body.appendChild(dialog);
  input.focus();
}

function showEditDialog(currentText, onSave) {
  document.querySelector(".edit-dialog")?.remove();

  const dialog = document.createElement("div");
  dialog.className = "edit-dialog";
  dialog.innerHTML = `
    <div class="edit-dialog-content">
      <div class="edit-dialog-title">메시지 수정</div>
      <textarea class="edit-dialog-input" rows="4">${currentText || ""}</textarea>
      <div class="edit-dialog-buttons">
        <button class="edit-dialog-cancel">취소</button>
        <button class="edit-dialog-save">저장</button>
      </div>
    </div>
  `;

  const textarea = dialog.querySelector(".edit-dialog-input");

  dialog.querySelector(".edit-dialog-save").addEventListener("click", () => {
    const text = textarea.value;
    dialog.remove();
    onSave(text);
  });
  dialog.querySelector(".edit-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });

  document.body.appendChild(dialog);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function showPasscodeDialog(targetChannel, onSuccess) {
  document.querySelector(".passcode-dialog")?.remove();

  const dialog = document.createElement("div");
  dialog.className = "passcode-dialog";
  dialog.innerHTML = `
    <div class="passcode-dialog-content">
      <div class="passcode-dialog-title">${targetChannel.name}</div>
      <div class="passcode-dialog-subtitle">비밀번호를 입력하세요</div>
      <input class="passcode-dialog-input" type="password" autocomplete="off" inputmode="numeric" />
      <div class="passcode-dialog-error" style="display:none">비밀번호가 틀렸습니다</div>
      <div class="passcode-dialog-buttons">
        <button class="passcode-dialog-cancel">취소</button>
        <button class="passcode-dialog-confirm">확인</button>
      </div>
    </div>
  `;

  const input = dialog.querySelector(".passcode-dialog-input");
  const errorEl = dialog.querySelector(".passcode-dialog-error");

  // fetch passcode hash from DB, fall back to config.js
  let storedHash = targetChannel.passcode || null;
  let hashReady = IS_MOCK;
  if (!IS_MOCK) {
    getChannelPasscode(targetChannel.id).then(dbHash => {
      if (dbHash) storedHash = dbHash;
      hashReady = true;
    }).catch(() => { hashReady = true; });
  }

  function submit() {
    if (!hashReady) return; // wait for DB fetch
    const code = input.value.trim();
    if (!code) return;
    hashString(code).then(hashed => {
      if (storedHash && hashed === storedHash) {
        dialog.remove();
        onSuccess();
      } else {
        errorEl.style.display = "block";
        input.value = "";
        input.focus();
      }
    });
  }

  dialog.querySelector(".passcode-dialog-confirm").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  });
  dialog.querySelector(".passcode-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });

  document.body.appendChild(dialog);
  setTimeout(() => input.focus(), 100);
}

/* ---- Initialize live mode module ---- */
initLiveMode({
  getState: () => ({ urlChannel, isAdmin, liveActive, inLiveMode, allMessages, messages, dmMessages, hasScrolledInitial, IS_MOCK }),
  setState: (updates) => {
    if ("inLiveMode" in updates) inLiveMode = updates.inLiveMode;
    if ("liveActive" in updates) liveActive = updates.liveActive;
    if ("allMessages" in updates) allMessages = updates.allMessages;
    if ("messages" in updates) messages = updates.messages;
    if ("dmMessages" in updates) dmMessages = updates.dmMessages;
    if ("hasScrolledInitial" in updates) hasScrolledInitial = updates.hasScrolledInitial;
  },
  subscribe,
  setChannel,
  initBroadcast,
  subscribeCurrentNotice,
  render,
  debouncedRender,
  banner,
  adminEndLive,
  broadcastEmoji,
  showConfirmDialog,
});

/* ---- Initialize search module ---- */
initSearch();
configureSearch({
  getMessages: () => messages,
  getAllMessages: () => allMessages,
  searchServer: searchMessages,
  onServerResults: (serverResults) => {
    const newMsgs = serverResults.filter((m) => !allMessages.find((a) => a.id === m.id));
    if (newMsgs.length > 0) {
      allMessages = [...newMsgs, ...allMessages];
      allMessages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      refilterMessages();
      render();
    }
  },
  banner,
  isMock: IS_MOCK,
});

initAuth().then((uid) => {
  myUid = uid;
  myNick = anonNameFor(uid);
  if (isAdmin) syncAdminColor();
  showEntryGate();          // pick a role (anon by default), then enter
}).catch((e) => {
  console.error("auth failed", e);
  banner(IS_MOCK ? "초기화 실패" : "익명 로그인 실패 — Authentication에서 Anonymous를 켜세요");
});

/* ============================================================
   CONTEXT MENU  —  iOS-style long-press menu with reactions + actions
   ============================================================ */
let blockedUids = new Set(getBlockedUsers().map(b => b.uid));
let blockedFingerprints = new Set(getBlockedUsers().filter(b => b.fingerprint).map(b => b.fingerprint));
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
  if (isAdmin && !IS_MOCK) await adminDeleteMessage(id);
  else await removeMessage(id);
}

async function doDeleteGallery(id) {
  if (isAdmin && !IS_MOCK) await adminDeleteGallery(id);
  else await removeFromGallery(id);
}

async function doBlock(uid, reason, fingerprint) {
  if (isAdmin && !IS_MOCK) await adminBlock(uid, reason);
  else await blockUser(uid, reason, fingerprint);
}

async function doUnblock(uid) {
  if (isAdmin && !IS_MOCK) await adminUnblock(uid);
  else {
    const { unblockUser: ub } = await import("./backend/index.js");
    await ub(uid);
  }
}

async function doEditMessage(id, newText) {
  // optimistic update — re-render immediately
  const msg = allMessages.find(m => m.id === id);
  if (msg) { msg.text = newText; msg.edited = true; }
  render();
  // broadcast to other clients instantly
  broadcastEdit(id, newText);
  // sync to server (persistence)
  if (isAdmin && !IS_MOCK) await adminUpdateMessage(id, { text: newText, edited: true });
  else await editMessage(id, newText);
}

async function doDeleteDm(id) {
  if (isAdmin && !IS_MOCK) await adminDeleteDm(id);
  else await removeDm(id);
}

async function doSetNotice(text) {
  const noticeChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
  if (isAdmin && !IS_MOCK) await adminSetNotice(text, noticeChannel);
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
  if (isAdmin && !IS_MOCK) {
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
        doDeleteMessage(msg.id);
      } else {
        deleteMessageWithReplies(msg.id);
      }
    }});
    actions.push({ label: "사용자 차단", icon: ICONS.block, danger: true, handler: () => {
      const isBlocked = blockedUids.has(msg.uid);
      if (isBlocked) { blockedUids.delete(msg.uid); doUnblock(msg.uid); }
      else { blockedUids.add(msg.uid); doBlock(msg.uid, msg.text, msg.fingerprint); }
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
      showEditDialog(msg.text, (newText) => {
        if (newText.trim()) doEditMessage(msg.id, newText.trim());
      });
    }});
    actions.push({ label: "삭제", icon: ICONS.delete, danger: true, handler: () => {
      if (msg.galleryId) doDeleteGallery(msg.galleryId);
      doDeleteMessage(msg.id);
    }});
    return actions;
  } else if (!isAdmin && isMe) {
    // non-admin viewing own messages
    const actions = [];
    actions.push({ label: "답장", icon: ICONS.reply, danger: false, handler: () => {
      const target = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) || msg : msg;
      setReply(target);
    }});
    if (msg.text && !msg.galleryId) {
      actions.push({ label: "수정", icon: ICONS.edit, danger: false, handler: () => {
        showEditDialog(msg.text, (newText) => {
          if (newText.trim()) doEditMessage(msg.id, newText.trim());
        });
      }});
    }
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
    patchReactions();
  }

  // then sync to backend
  addReactionBackend(msgId, emoji, reactUid);
}

async function reportMessage(msg) {
  const preview = msg.text.length > 50 ? msg.text.slice(0, 50) + "…" : msg.text;
  const reportText = `🚨 신고된 채팅: "${preview}"`;
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
    await doDeleteMessage(reportMsg.id);
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
const scrollBottomBtn = $("#scrollBottomBtn");
let replyingTo = null; // { id, text } of message being replied to

/* ---- Scroll-to-bottom FAB ---- */
messagesEl.addEventListener("scroll", () => {
  const distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  scrollBottomBtn.classList.toggle("visible", distFromBottom >= 120);
});
scrollBottomBtn.addEventListener("click", () => {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  scrollBottomBtn.classList.remove("visible");
});

function toggleSend() {
  const has = input.value.trim().length > 0 || pendingPhotos.length > 0;
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
  const blocked = !isAdmin && (blockedUids.has(myUid) || blockedFingerprints.has(myFingerprint));
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
  if (!text && !pendingPhotos.length || !myUid) return;

  // blocked user petition: send one DM then lock
  const isBlocked = !isAdmin && blockedUids.has(myUid);
  const hasPetitioned = localStorage.getItem("petitionSent") === myUid;
  if (isBlocked && hasPetitioned) {
    banner("차단되어 채팅을 보낼 수 없습니다");
    return;
  }
  if (isBlocked && !hasPetitioned) {
    // send as DM petition with the blocked reason quoted
    const blockEntry = blockedList.find((b) => b.uid === myUid);
    const reason = blockEntry && blockEntry.reason ? `\n[차단 사유: "${blockEntry.reason}"]` : "";
    await sendDm({ uid: myUid, nick: myNick, text: `[이의 제기] ${text}${reason}`, image: pendingPhotos[0]?.blob || undefined });
    localStorage.setItem("petitionSent", myUid);
    input.value = "";
    input.style.height = "auto";
    pendingPhotos = [];
    removePhotoPreview();
    checkIfBlocked();
    banner("이의 제기가 전송되었습니다", "#ff3b30");
    return;
  }

  if (checkIfBlocked()) {
    banner("차단되어 채팅을 보낼 수 없습니다");
    return;
  }
  if (isRateLimited()) {
    banner("채팅을 너무 빠르게 보내고 있습니다. 잠시 후 다시 시도해주세요.");
    return;
  }
  const savedText = input.value;
  input.value = "";
  input.style.height = "auto";
  toggleSend();
  const nick = isAdmin ? "관리자" : myNick;
  const sendUid = isAdmin ? "admin" : myUid;
  const msgData = { uid: sendUid, nick, text, is_admin: isAdmin, adminPasscode: isAdmin ? getAdminPasscode() : null, fingerprint: myFingerprint };
  const photos = [...pendingPhotos];
  pendingPhotos = [];
  removePhotoPreview();
  if (replyingTo) { msgData.replyTo = replyingTo.id; }
  clearReply();
  try {
    if (dmMode && !isAdmin) {
      await sendDm({ uid: sendUid, nick, text, image: photos[0]?.blob, imageW: photos[0]?.dimensions?.width, imageH: photos[0]?.dimensions?.height });
      dmMode = false;
      updateDmUI();
      banner("찍이에게 전송됨", "#9b59b6");
    } else {
      // send text message (with first photo attached if any)
      if (photos.length > 0) {
        const first = photos[0];
        const galleryId = await saveToGallery(first.blob);
        msgData.galleryId = galleryId;
        msgData.imageW = first.dimensions?.width;
        msgData.imageH = first.dimensions?.height;
      }
      await sendMessage(msgData);

      // send remaining photos as separate messages
      for (let i = 1; i < photos.length; i++) {
        const p = photos[i];
        const galleryId = await saveToGallery(p.blob);
        await sendMessage({ uid: sendUid, nick, text: "", is_admin: isAdmin, adminPasscode: isAdmin ? getAdminPasscode() : null, galleryId, imageW: p.dimensions?.width, imageH: p.dimensions?.height });
      }
    }
    sendTimestamps.push(Date.now());
    input.blur(); // dismiss keyboard
  }
  catch (e) {
    console.error("send failed", e);
    // restore text on failure
    input.value = savedText;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 80) + "px";
    toggleSend();
    if (e.message === "banned") banner("차단되어 전송할 수 없습니다");
    else if (e.message === "rate_limited") banner("너무 빠르게 보내고 있습니다");
    else if (e.message === "banned_word") banner("금지어가 포함되어 전송할 수 없습니다");
    else banner("전송 실패");
  }
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
  showFullImageBase(src, meta, scrollToMessageSilent);
}

/* ============================================================
   LINK PREVIEW — handled by ./embeds.js
   ============================================================ */

function scrollToMessage(msgId) {
  const el = document.getElementById(`msg-${msgId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // highlight the target message briefly
    el.classList.add("highlight-flash");
    setTimeout(() => el.classList.remove("highlight-flash"), 2000);
  } else {
    // message might not be loaded yet — try loading older messages
    banner("해당 채팅을 찾을 수 없습니다");
  }
}

function scrollToMessageSilent(msgId) {
  const el = document.getElementById(`msg-${msgId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    banner("해당 채팅을 찾을 수 없습니다");
  }
}

const photoBtn = $("#photoBtn");
const photoInput = $("#photoInput");
let pendingPhoto = null; // stores the compressed Blob/File until user sends
let pendingPhotoDimensions = null; // { width, height } of pending photo
let pendingPhotos = []; // array of { blob, dimensions, previewUrl } for multi-select
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
    ${inLiveMode ? '<button class="plus-menu-item" data-action="emoji-preset"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> 이모지 프리셋</button>' : ''}
  `;

  menu.querySelector('[data-action="photo"]').addEventListener("click", () => { menu.remove(); photoInput.click(); });
  menu.querySelector('[data-action="notice"]').addEventListener("click", () => { menu.remove(); showNoticeInput(); });
  if (inLiveMode) menu.querySelector('[data-action="emoji-preset"]')?.addEventListener("click", () => { menu.remove(); showEmojiPresetPanel(); });

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
  document.querySelector(".notice-edit-dialog")?.remove();

  // parse current notice for pre-fill
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
      <input class="notice-edit-title" type="text" placeholder="공지 제목 (비우면 공지 삭제)" value="${currentTitle.replace(/"/g, "&quot;")}" />
      <textarea class="edit-dialog-input" rows="4" placeholder="공지 내용 (선택사항)">${currentBody}</textarea>
      <div class="edit-dialog-buttons">
        <button class="edit-dialog-cancel">취소</button>
        <button class="edit-dialog-save">저장</button>
      </div>
    </div>
  `;

  const titleInput = dialog.querySelector(".notice-edit-title");
  const bodyInput = dialog.querySelector(".edit-dialog-input");

  dialog.querySelector(".edit-dialog-save").addEventListener("click", () => {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    dialog.remove();
    if (!title) {
      setNoticeBanner("");
      banner("공지가 삭제되었습니다");
      return;
    }
    const notice = body
      ? JSON.stringify({ title, body })
      : title;
    setNoticeBanner(notice);
  });
  dialog.querySelector(".edit-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });

  document.body.appendChild(dialog);
  titleInput.focus();
}

let currentNotice = "";
let noticeUnsub = null;

function subscribeCurrentNotice() {
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

function setNoticeBanner(text) {
  currentNotice = text;
  const activeChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
  localStorage.removeItem(`noticeDismissed_${activeChannel}`);
  doSetNotice(text);
  renderNoticeBanner();
}

function renderNoticeBanner() {
  document.querySelector(".notice-banner")?.remove();
  if (!currentNotice) return;
  const activeChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
  // in live mode, always show notice; in normal mode, check dismiss state
  if (!inLiveMode && localStorage.getItem(`noticeDismissed_${activeChannel}`) === currentNotice) return;

  // parse notice: JSON with title/body or plain text (backward compat)
  let title = currentNotice;
  let body = "";
  try {
    const parsed = JSON.parse(currentNotice);
    if (parsed.title) { title = parsed.title; body = parsed.body || ""; }
  } catch { /* plain text notice — title only */ }

  const banner = document.createElement("div");
  banner.className = "notice-banner";

  let html = `
    <span class="notice-banner-icon"><svg viewBox="0 0 32 32" width="16" height="16" fill="currentColor"><path d="M5.063,19.369l0.521,4.602c0.007,0.067,0.021,0.133,0.042,0.197c0.412,1.266,1.591,2.072,2.855,2.072c0.308,0,0.619-0.048,0.927-0.148c1.572-0.512,2.436-2.208,1.924-3.781l-0.83-2.551h0.261l7.789,3.895c0.142,0.07,0.294,0.105,0.447,0.105c0.183,0,0.365-0.05,0.525-0.149C19.82,23.429,20,23.107,20,22.76v-4.142c1.721-0.447,3-2,3-3.858s-1.279-3.411-3-3.858V6.76c0-0.347-0.18-0.668-0.475-0.851c-0.295-0.183-0.663-0.199-0.973-0.044L10.764,9.76H7c-2.757,0-5,2.243-5,5C2,16.831,3.265,18.611,5.063,19.369z M9.43,22.93c0.171,0.524-0.116,1.089-0.641,1.26c-0.499,0.163-1.032-0.089-1.231-0.562L7.119,19.76h1.279L9.43,22.93z M21,14.76c0,0.737-0.405,1.375-1,1.722v-3.443C20.595,13.385,21,14.023,21,14.76z M18,21.142l-6-3v-6.764l6-3V21.142z M7,11.76h3v6H7c-1.654,0-3-1.346-3-3S5.346,11.76,7,11.76z"/><path d="M27,15.76h2c0.553,0,1-0.448,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.448-1,1S26.447,15.76,27,15.76z"/><path d="M27,10.467c0.256,0,0.512-0.098,0.707-0.293l1.414-1.414c0.391-0.391,0.391-1.023,0-1.414s-1.023-0.391-1.414,0L26.293,8.76c-0.391,0.391-0.391,1.023,0,1.414C26.488,10.37,26.744,10.467,27,10.467z"/><path d="M27.707,22.174c0.195,0.195,0.451,0.293,0.707,0.293s0.512-0.098,0.707-0.293c0.391-0.391,0.391-1.023,0-1.414l-1.414-1.414c-0.391-0.391-1.023-0.391-1.414,0s-0.391,1.023,0,1.414L27.707,22.174z"/></svg></span>
    <span class="notice-banner-title">${title}</span>
  `;

  if (body) {
    html += `<button class="notice-banner-expand">▼</button>`;
  }
  html += `<button class="notice-banner-close">✕</button>`;

  banner.innerHTML = html;

  if (body) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "notice-banner-body";
    bodyEl.textContent = body;
    bodyEl.style.display = "none";
    banner.appendChild(bodyEl);

    banner.querySelector(".notice-banner-expand").addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = bodyEl.style.display !== "none";
      bodyEl.style.display = isExpanded ? "none" : "block";
      e.target.textContent = isExpanded ? "▼" : "▲";
    });
  }

  banner.querySelector(".notice-banner-close").addEventListener("click", () => {
    const activeChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
    localStorage.setItem(`noticeDismissed_${activeChannel}`, currentNotice);
    banner.remove();
  });

  // insert after header
  // insert after live banner if present, otherwise after header
  const liveBannerEl = document.querySelector(".live-exit-banner") || document.querySelector(".live-banner");
  if (liveBannerEl) {
    liveBannerEl.insertAdjacentElement("afterend", banner);
  } else {
    document.querySelector(".chat-header").insertAdjacentElement("afterend", banner);
  }
}

function showPlusMenu(e) {
  document.querySelector(".plus-menu")?.remove();

  const menu = document.createElement("div");
  menu.className = "plus-menu";
  menu.innerHTML = `
    <button class="plus-menu-item" data-action="dm"><svg viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ${dmMode ? "일반 채팅으로 전환" : "비밀 메시지"}</button>
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
  const files = [...photoInput.files];
  if (!files.length) return;
  photoInput.value = "";

  // multiple files → queue all with previews
  if (files.length > 1) {
    for (const file of files) {
      const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
      if (!isGif && file.size > 50 * 1024 * 1024) continue; // skip oversized

      let photoBlob, dims;
      if (isGif) {
        photoBlob = file;
        dims = await getImageDimensions(file);
      } else {
        const result = await compressImage(file, 2000, 0.85);
        photoBlob = result.blob;
        dims = { width: result.width, height: result.height };
      }

      const previewUrl = URL.createObjectURL(photoBlob);
      pendingPhotos.push({ blob: photoBlob, dimensions: dims, previewUrl });
    }
    showMultiPhotoPreview();
    input.focus();
    toggleSend();
    return;
  }

  // single file → preview then send
  const file = files[0];

  // check size limit (50MB max for Supabase Storage) — skip for GIFs
  const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
  if (!isGif && file.size > 50 * 1024 * 1024) {
    banner("파일이 너무 큽니다 (최대 50MB)");
    return;
  }

  // compress to Blob (skip for GIFs to preserve animation)
  let photoBlob;
  let photoDimensions = null;
  if (isGif) {
    photoBlob = file;
    photoDimensions = await getImageDimensions(file);
  } else {
    const result = await compressImage(file, 2000, 0.85);
    photoBlob = result.blob;
    photoDimensions = { width: result.width, height: result.height };
  }

  // use object URL for preview (zero-copy, no base64)
  const previewUrl = URL.createObjectURL(photoBlob);
  pendingPhotos.push({ blob: photoBlob, dimensions: photoDimensions, previewUrl });
  showMultiPhotoPreview();
  input.focus();
  toggleSend();
});

function showMultiPhotoPreview() {
  removePhotoPreview();
  if (pendingPhotos.length === 0) return;

  const preview = document.createElement("div");
  preview.className = "photo-preview";

  const grid = document.createElement("div");
  grid.className = "photo-preview-grid";

  pendingPhotos.forEach((p, i) => {
    const wrap = document.createElement("div");
    wrap.className = "photo-preview-thumb";
    wrap.innerHTML = `
      <img src="${p.previewUrl}" class="photo-preview-img" />
      <button class="photo-preview-remove" data-idx="${i}">✕</button>
    `;
    grid.appendChild(wrap);
  });

  preview.appendChild(grid);

  // remove individual photos
  preview.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".photo-preview-remove");
    if (removeBtn) {
      const idx = parseInt(removeBtn.dataset.idx);
      URL.revokeObjectURL(pendingPhotos[idx].previewUrl);
      pendingPhotos.splice(idx, 1);
      showMultiPhotoPreview();
      toggleSend();
    }
  });

  document.querySelector(".composer").insertAdjacentElement("beforebegin", preview);
}

function removePhotoPreview() {
  const existing = document.querySelector(".photo-preview");
  if (existing) {
    existing.querySelectorAll("img").forEach((img) => {
      if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    });
    existing.remove();
  }
}

/* compressImage — imported from ./photo.js */

/* ============================================================
   GALLERY VIEW — handled by ./gallery.js
   ============================================================ */
function showGallery() {
  showGalleryBase(galleryItems, allMessages, showFullImage);
}

/* ============================================================
   LINKS PANEL — handled by ./links-panel.js
   ============================================================ */
function showLinks() {
  showLinksBase(allMessages, scrollToMessageSilent);
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
  const avatar = document.querySelector(".hdr-avatar");
  const header = document.querySelector(".chat-header");
  if (!avatar || !header) return;

  // avatar tap → channel picker
  avatar.addEventListener("click", () => {
    if (channels.length > 1) showChannelPicker();
  });

  // header name long press → admin toggle
  let pressTimer = null;
  header.addEventListener("pointerdown", (e) => {
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
        if (inLiveMode) showLiveExitBanner();
        banner("관리자 모드 해제");
      } else {
        const pass = prompt("관리자 비밀번호:");
        if (pass) {
          const valid = IS_MOCK ? true : await verifyAdmin(pass);
          if (valid === true) {
            setAdminPasscode(pass);
            isAdmin = true;
            localStorage.setItem("isAdmin", "true");
            localStorage.setItem("ap", btoa(pass));
            checkIfBlocked();
            refilterMessages();
            render();
            syncAdminColor();
            if (inLiveMode) showLiveExitBanner();
            banner("관리자 모드 활성화");
          } else if (valid === "rate_limited") {
            banner("그만해라");
          } else {
            banner("나이스시도 ㅋ");
          }
        }
      }
    }, 800);
  });
  header.addEventListener("pointerup", () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
  header.addEventListener("pointerleave", () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
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

/* ============================================================
   SEARCH — handled by ./search.js
   ============================================================ */

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
    ${isAdmin ? '<button class="header-menu-item header-menu-admin" data-action="admin"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill="none" stroke="currentColor" stroke-width="2"/></svg> 관리자 설정</button>' : ''}
  `;

  menu.querySelector('[data-action="settings"]').addEventListener("click", () => { menu.remove(); showSettingsPanel(); });
  menu.querySelector('[data-action="gallery"]').addEventListener("click", () => { menu.remove(); showGallery(); });
  menu.querySelector('[data-action="links"]').addEventListener("click", () => { menu.remove(); showLinks(); });
  if (isAdmin) menu.querySelector('[data-action="admin"]')?.addEventListener("click", () => { menu.remove(); showAdminPanel(); });

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
  const currentColor = localStorage.getItem(`bubbleColor_${urlChannel}`) || currentChannelConfig.bubble || "#3b8df0";
  const bubbleColors = ["#3b8df0", "#9b59b6", "#2e7d32", "#e74c3c", "#f39c12", "#1abc9c", "#e91e63"];

  function darkenColor(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0xff) - amount);
    const b = Math.max(0, (num & 0xff) - amount);
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
  }

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
    btn.addEventListener("click", (e) => {
      if (btn.classList.contains("settings-color-custom")) return; // handled by input
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

/* ============================================================
   LIVE MODE — handled by ./modules/live.js
   ============================================================ */

/* ============================================================
   ADMIN PANEL — global admin settings
   ============================================================ */
function showAdminPanel() {
  document.querySelector(".admin-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "admin-panel";

  const currentColor = localStorage.getItem(`bubbleColor_${urlChannel}`) || currentChannelConfig.bubble || "#3b8df0";
  const bubbleColors = ["#3b8df0", "#9b59b6", "#2e7d32", "#e74c3c", "#f39c12", "#1abc9c", "#e91e63"];

  function darkenColor(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0xff) - amount);
    const b = Math.max(0, (num & 0xff) - amount);
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
  }

  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>관리자 설정</h3>
        <button class="admin-panel-close">✕</button>
      </div>
      <div class="admin-panel-body">
        <div class="admin-panel-section">
          <button class="admin-panel-item" data-action="notice">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
            <span class="admin-panel-label">전체 공지</span>
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
          <button class="admin-panel-item admin-panel-live" data-action="live">
            <span class="admin-panel-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M4.93 4.93a10 10 0 0 1 14.14 0"/><path d="M7.76 7.76a6 6 0 0 1 8.48 0"/></svg></span>
            <span class="admin-panel-label">${liveActive ? "라이브 종료" : "라이브 시작"}</span>
            <span class="admin-panel-arrow" style="color:${liveActive ? "#e74c3c" : ""}">●</span>
          </button>
          ${liveActive ? `` : ""}
        </div>
      </div>
    </div>
  `;

  panel.querySelector(".admin-panel-close").addEventListener("click", () => panel.remove());
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });

  // notice
  panel.querySelector('[data-action="notice"]').addEventListener("click", () => {
    panel.remove();
    showNoticeInput();
    // re-show admin panel after notice prompt completes (setTimeout to wait for prompt)
    setTimeout(() => showAdminPanel(), 100);
  });

  // channel default color
  panel.querySelector('[data-action="color"]').addEventListener("click", () => {
    panel.remove();
    showAdminColorPanel();
  });

  // passcode management
  panel.querySelector('[data-action="passcode"]').addEventListener("click", () => {
    panel.remove();
    showAdminPasscodePanel();
  });

  // blocked users
  panel.querySelector('[data-action="blocked"]').addEventListener("click", () => {
    panel.remove();
    showBlockedPanel();
  });

  // banned words
  panel.querySelector('[data-action="banned-words"]').addEventListener("click", () => {
    panel.remove();
    showBannedWordsPanel();
  });

  // live mode toggle
  panel.querySelector('[data-action="live"]').addEventListener("click", async () => {
    panel.remove();
    if (liveActive) {
      // end live mode
      showConfirmDialog("라이브 종료", "라이브를 종료하시겠습니까?<br>모든 메시지가 삭제됩니다.", async () => {
        if (!IS_MOCK) await adminEndLive(urlChannel);
        liveActive = false;
        localStorage.setItem(`liveActive_${urlChannel}`, "false");
        localStorage.removeItem(`liveSeen_${urlChannel}`);
        localStorage.removeItem(`liveTitle_${urlChannel}`);
        localStorage.removeItem(`mock_notice_${urlChannel}_live`);
        if (inLiveMode) {
          localStorage.setItem(`liveEnded_${urlChannel}`, "true");
          exitLiveMode();
        }
      });
    } else {
      // start live mode
      showPromptDialog("라이브 시작", "라이브 제목을 입력하세요", async (liveTitle) => {
        if (!IS_MOCK) await adminStartLive(urlChannel, liveTitle);
        liveActive = true;
        localStorage.setItem(`liveTitle_${urlChannel}`, liveTitle);
        localStorage.setItem(`liveActive_${urlChannel}`, "true");
        localStorage.removeItem(`liveSeen_${urlChannel}`);
        enterLiveMode();
        banner("라이브가 시작되었습니다");
      });
    }
  });

  // emoji preset now in + menu during live mode

  document.body.appendChild(panel);
}

function showEmojiPresetPanel() {
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
      <div class="admin-panel-body" style="padding:20px 18px;">
        <div class="emoji-preset-list" id="emojiPresetList"></div>
        <div class="banned-words-add">
          <button class="emoji-preset-add-btn">+ 추가</button>
        </div>
        <div class="admin-passcode-result" style="display:none;margin-top:10px;font-size:12px;text-align:center;color:#2ecc71;"></div>
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
        <span class="banned-word-text" style="font-size:calc(var(--bubble-font-size, 17px) + 4px)">${e}</span>
        <button class="banned-word-remove" data-idx="${i}">✕</button>
      </div>
    `).join("");

    // drag-to-reorder
    let dragIdx = null;
    listEl.querySelectorAll(".emoji-preset-item").forEach(item => {
      item.addEventListener("dragstart", (e) => {
        dragIdx = parseInt(item.dataset.idx);
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        dragIdx = null;
      });
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

    // touch drag for mobile
    let touchIdx = null;
    let touchClone = null;
    listEl.querySelectorAll(".emoji-preset-item").forEach(item => {
      item.addEventListener("touchstart", (e) => {
        touchIdx = parseInt(item.dataset.idx);
        item.classList.add("dragging");
      }, { passive: true });
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
      item.addEventListener("touchend", () => {
        item.classList.remove("dragging");
        touchIdx = null;
      });
    });
  }
  renderEmojis();

  // reorder (handled inline above)

  // remove
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".banned-word-remove");
    if (btn) {
      emojis.splice(parseInt(btn.dataset.idx), 1);
      renderEmojis();
      saveEmojis();
    }
  });

  // add via emoji picker
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
      if (!emojis.includes(emoji)) {
        emojis.push(emoji);
        renderEmojis();
        saveEmojis();
      }
    });
    // toggle
    const existing = panel.querySelector(".emoji-fx-picker-wrap");
    if (existing) { existing.remove(); return; }
    panel.querySelector(".banned-words-add").insertAdjacentElement("afterend", pickerWrap);
  });

  function saveEmojis() {
    localStorage.setItem(`liveEmojis_${activeChannel}`, JSON.stringify(emojis));
    resultEl.textContent = "✓ 저장됨";
    resultEl.style.display = "block";
    setTimeout(() => { resultEl.style.display = "none"; }, 1500);
    // update the emoji bar if visible
    updateEmojiBarPresets(emojis);
  }

  panel.querySelector(".emoji-preset-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });

  document.body.appendChild(panel);
}

function showAdminColorPanel() {
  document.querySelector(".admin-color-panel")?.remove();

  const currentColor = localStorage.getItem(`bubbleColor_${urlChannel}`) || currentChannelConfig.bubble || "#3b8df0";
  const bubbleColors = ["#3b8df0", "#9b59b6", "#2e7d32", "#e74c3c", "#f39c12", "#1abc9c", "#e91e63"];

  function darkenColor(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0xff) - amount);
    const b = Math.max(0, (num & 0xff) - amount);
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
  }

  const panel = document.createElement("div");
  panel.className = "admin-color-panel";

  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>채널 기본 색상</h3>
        <button class="admin-color-close">✕</button>
      </div>
      <div class="admin-panel-body" style="padding:20px 18px;">
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
    btn.addEventListener("click", (e) => {
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

function showAdminPasscodePanel() {
  document.querySelector(".admin-passcode-panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "admin-passcode-panel";

  panel.innerHTML = `
    <div class="admin-panel-content">
      <div class="admin-panel-header">
        <h3>채널 비밀번호</h3>
        <button class="admin-passcode-close">✕</button>
      </div>
      <div class="admin-panel-body" style="padding:20px 18px;">
        <div class="admin-color-info" style="margin-bottom:16px;">현재 채널: ${currentChannelConfig.name}</div>
        <input class="passcode-dialog-input" type="text" placeholder="새 비밀번호 입력" autocomplete="off" style="margin-bottom:8px;" />
        <div class="admin-color-info" style="margin-bottom:16px;font-size:11px;">비우면 비밀번호 해제</div>
        <button class="admin-passcode-save" style="width:100%;background:var(--bubble-sent,#3b8df0);border:none;border-radius:12px;padding:11px;font-size:14px;font-weight:400;color:#fff;cursor:pointer;font-family:inherit;">저장</button>
        <div class="admin-passcode-result" style="display:none;margin-top:10px;font-size:12px;text-align:center;color:#2ecc71;font-weight:400;"></div>
      </div>
    </div>
  `;

  panel.querySelector(".admin-passcode-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });

  const input = panel.querySelector(".passcode-dialog-input");
  const resultEl = panel.querySelector(".admin-passcode-result");

  panel.querySelector(".admin-passcode-save").addEventListener("click", async () => {
    const code = input.value.trim();
    if (!code) {
      // clear passcode
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

function showBannedWordsPanel() {
  document.querySelector(".banned-words-panel")?.remove();

  const activeChannel = inLiveMode ? `${urlChannel}_live` : urlChannel;
  // load words as JSON array: [{ word, expires }]
  let words = [];
  try {
    const raw = localStorage.getItem(`bannedWords_${activeChannel}`) || "";
    if (raw.startsWith("[")) {
      words = JSON.parse(raw);
    } else if (raw) {
      // migrate from old comma-separated format
      words = raw.split(",").map(w => ({ word: w.trim(), expires: null })).filter(w => w.word);
    }
  } catch { words = []; }

  // filter out expired words
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
      <div class="admin-panel-body" style="padding:20px 18px;">
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
        <div class="admin-passcode-result" style="display:none;margin-top:10px;font-size:12px;text-align:center;color:#2ecc71;"></div>
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
      ? '<div style="color:var(--meta);font-size:var(--bubble-font-size, 13px);text-align:center;padding:12px 0;">등록된 금지어가 없습니다</div>'
      : words.map((w, i) => `
        <div class="banned-word-item">
          <span class="banned-word-text">${w.word}</span>
          <span class="banned-word-expiry">${formatExpiry(w.expires)}</span>
          <button class="banned-word-remove" data-idx="${i}">✕</button>
        </div>
      `).join("");
  }
  renderWords();

  // remove a word
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".banned-word-remove");
    if (btn) {
      words.splice(parseInt(btn.dataset.idx), 1);
      renderWords();
      saveWords();
    }
  });

  // add a word
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

  panel.querySelector(".blocked-panel-close").addEventListener("click", () => { showAdminPanel(); panel.remove(); });
  panel.addEventListener("click", (e) => { if (e.target === panel) { showAdminPanel(); panel.remove(); } });

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
  // restore live mode if user was in it
  if (inLiveMode && liveActive) {
    setChannel(`${urlChannel}_live`);
    document.querySelector(".chat-header").classList.add("live-active");
    showLiveExitBanner();
    showEmojiBar();
  }
  // messages container starts hidden via CSS; revealed after first scroll-to-bottom
  // force scroll to bottom for first 2 seconds while images load
  setTimeout(() => { initialLoad = false; }, 2000);
  // scroll anchor: scroll to bottom once after first render
  hasScrolledInitial = false;
  userInteracted = false;
  const stopAutoScroll = () => { userInteracted = true; };
  messagesEl.addEventListener("touchstart", stopAutoScroll, { once: true });
  messagesEl.addEventListener("wheel", stopAutoScroll, { once: true });
  input.addEventListener("focus", stopAutoScroll, { once: true });

  // keep scrolling to bottom as images load during initial period
  const imgObserver = new MutationObserver(() => {
    if (userInteracted || hasScrolledInitial === false) return;
    if (initialLoad) {
      messagesEl.querySelectorAll("img").forEach((img) => {
        if (!img.dataset.scrollBound) {
          img.dataset.scrollBound = "1";
          img.addEventListener("load", () => {
            if (!userInteracted && initialLoad) {
              const anchor = messagesEl.querySelector(".scroll-anchor");
              if (anchor) anchor.scrollIntoView({ behavior: "auto" });
            }
          }, { once: true });
        }
      });
    }
  });
  imgObserver.observe(messagesEl, { childList: true, subtree: true });
  let galleryLoaded = false;
  subscribeBlocked((list) => { blockedList = list; blockedUids = new Set(list.map(b => b.uid)); blockedFingerprints = new Set(list.filter(b => b.fingerprint).map(b => b.fingerprint)); checkIfBlocked(); refilterMessages(); if (galleryLoaded) render(); });
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
    if (!galleryLoaded) return; // wait for gallery before first render
    // check if only reactions changed (same message count/ids)
    if (canPatchReactions(list)) {
      patchReactions();
    } else {
      debouncedRender();
    }
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
    if (!initialLoad) debouncedRender();
  });
  // subscribe to gallery
  subscribeGallery((list) => { galleryItems = list; if (!galleryLoaded) { galleryLoaded = true; render(); } else { debouncedRender(); } });
  // subscribe only to the active normal/live channel notice
  subscribeCurrentNotice();
  toggleSend();
  renderNoticeBanner();

  // init broadcast channel for instant edits + emoji effects
  if (!IS_MOCK) {
    initBroadcast();
    onEditBroadcast(({ id, text, edited }) => {
      const msg = allMessages.find(m => m.id === id);
      if (msg) { msg.text = text; msg.edited = edited; }
      debouncedRender();
    });
    onEmojiBroadcast(({ emoji, x, h }) => {
      spawnEmoji(emoji, x, h);
    });
  }

  // show "live ended" popup if user was kicked out by admin ending live
  if (localStorage.getItem(`liveEnded_${urlChannel}`)) {
    localStorage.removeItem(`liveEnded_${urlChannel}`);
    showLiveEndedPopup();
  }

  // keep old tabs synchronized with live start/end state
  subscribeLiveStatus(urlChannel, ({ active, title }) => {
    liveActive = active;
    localStorage.setItem(`liveActive_${urlChannel}`, active ? "true" : "false");
    if (title) localStorage.setItem(`liveTitle_${urlChannel}`, title);

    if (active && !isAdmin && !inLiveMode) {
      if (localStorage.getItem(`liveSeen_${urlChannel}`)) showLiveBanner();
      else showLivePopup();
    } else if (!active) {
      document.querySelector(".live-banner")?.remove();
      document.querySelector(".live-popup")?.remove();
      if (inLiveMode) {
        localStorage.setItem(`liveEnded_${urlChannel}`, "true");
        exitLiveMode();
      }
    }
  });

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
