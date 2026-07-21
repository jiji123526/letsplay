/* ============================================================
   iMessage UI  —  realtime chat (backend-agnostic)
   ------------------------------------------------------------
   This file is pure UI/UX. It talks only to ./backend.js, which
   is either the local mock (localStorage, no Firebase) or real
   Firebase — controlled by USE_MOCK in firebase-config.js.

   Message object: { id, uid, nick, text, is_admin, createdAt:Date }
   Renders blue "sent" when uid === my uid, else gray "recv".
   ============================================================ */

import { initAuth, initFromServer, onConnectionChange, subscribe, sendMessage, removeMessage, softDeleteMessage, editMessage, addReaction as addReactionBackend, removeReaction as removeReactionBackend, blockUser, getBlockedUsers, subscribeBlocked, sendDm, removeDm, subscribeDm, saveToGallery, subscribeGallery, removeFromGallery, setNotice, subscribeNotice, searchMessages, loadMoreMessages, setChannel, setAdminCredential, setClientFingerprint, getChannelPasscode, subscribeLiveStatus, broadcastLiveStatus, subscribeLivePresence, initBroadcast, onEditBroadcast, onEmojiBroadcast, broadcastEdit, broadcastDelete, onDeleteBroadcast, broadcastRefresh, onRefreshBroadcast, broadcastFreeze, onFreezeBroadcast, broadcastProfile, onProfileBroadcast, broadcastEmoji, IS_MOCK } from "./backend/index.js";
import { verifyAdmin, setAdminPasscode, getAdminPasscode, adminDeleteMessage, adminDeleteMessages, adminUpdateMessage, adminBlock, adminUnblock, adminDeleteDm, adminDeleteGallery, adminSetNotice, adminSetColor, adminGetColor, adminSetPasscode, adminGetPasscode, adminStartLive, adminEndLive } from "./admin/api.js";
import { embedTwitter, embedInstagram, embedYouTube, fetchLinkPreview } from "./modules/embeds.js";
import { compressImage, getImageDimensions, showFullImage as showFullImageBase } from "./modules/photo.js";
import { showGallery as showGalleryBase } from "./modules/gallery.js";
import { showLinks as showLinksBase } from "./modules/links-panel.js";
import { initSearch, configureSearch, restoreSearchHighlights, highlightTextInBubble, closeSearchBar } from "./modules/search.js";
import { initLiveMode, enterLiveMode, exitLiveMode, refreshLivePresence, showLivePopup, showLiveBanner, showLiveExitBanner, showLiveEndedPopup, removeLiveBanner, spawnEmoji, removeEmojiBar, showEmojiBar, updateEmojiBarPresets } from "./modules/live.js";
import { generateFingerprint } from "./modules/fingerprint.js";
import { showConfirmDialog, showPromptDialog, showEditDialog, showPasscodeDialog } from "./modules/dialogs.js";
import { showContextMenu, showDmMenu, ICONS, REACTIONS } from "./modules/context-menu.js";
import { initAdminPanels, showAdminPanel, showEmojiPresetPanel, showAdminColorPanel, showAdminPasscodePanel, showBannedWordsPanel, showBlockedPanel } from "./modules/admin-panels.js";
import { initNotice, subscribeCurrentNotice, setNoticeBanner, renderNoticeBanner, showNoticeInput, showNoticePanel } from "./modules/notice.js";
import { initSettings, showHeaderMenu, showSettingsPanel } from "./modules/settings.js";
import { hashString } from "./utils.js";
import { channels } from "../config.js";
import "emoji-picker-element";

const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages");

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
setClientFingerprint(myFingerprint);
let isAdmin = localStorage.getItem("isAdmin") === "true";
// restore admin passcode for API calls
if (isAdmin) {
  const storedPass = localStorage.getItem("ap");
  if (storedPass) {
    const passcode = atob(storedPass);
    setAdminPasscode(passcode);
    setAdminCredential(passcode);
    // verify stored passcode is still valid
    if (!IS_MOCK) {
      verifyAdmin(passcode).then((valid) => {
        if (valid !== true) {
          isAdmin = false;
          localStorage.setItem("isAdmin", "false");
          localStorage.removeItem("ap");
          setAdminPasscode(null);
          setAdminCredential(null);
        }
      }).catch(() => {});
    }
  } else {
    // no stored passcode — revoke admin
    isAdmin = false;
    localStorage.setItem("isAdmin", "false");
  }
}
let messages = [];               // filtered list for rendering
let allMessages = [];            // unfiltered list for lookups
let dmMessages = [];             // DM messages (admin only)
let dmUnsub = null;
let galleryItems = [];           // gallery photos
let galleryUnsub = null;
let galleryLoaded = false;
let initialLoad = true;          // force scroll to bottom for first 3 seconds
let hasScrolledInitial = false;
let userInteracted = false;
let liveActive = localStorage.getItem(`liveActive_${new URLSearchParams(window.location.search).get("ch") || window.location.pathname.match(/^\/ch\/([^/]+)/)?.[1] || "main"}`) === "true";
let inLiveMode = localStorage.getItem(`inLiveMode_${new URLSearchParams(window.location.search).get("ch") || window.location.pathname.match(/^\/ch\/([^/]+)/)?.[1] || "main"}`) === "true";
let isFrozen = false;
let reportedMsgIds = new Set(JSON.parse(localStorage.getItem("reportedMsgIds") || "[]"));

/* debounced render — batches rapid updates (reactions, etc.) into one render */
let renderTimer = null;
let skipNextScroll = false;
let prevMessageIds = [];

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
      pill.appendChild(document.createTextNode(`${emoji} `));
      const count = document.createElement("span");
      count.className = "reaction-count";
      count.textContent = String(data.count);
      pill.appendChild(count);
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

function appendTextWithLinks(container, text, urlRegex) {
  let lastIndex = 0;
  for (const match of text.matchAll(urlRegex)) {
    if (match.index > lastIndex) container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    const value = match[0];
    const link = document.createElement("a");
    link.href = value.startsWith("http") ? value : `https://${value}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "bubble-link";
    link.textContent = value;
    container.appendChild(link);
    lastIndex = match.index + value.length;
  }
  if (lastIndex < text.length) container.appendChild(document.createTextNode(text.slice(lastIndex)));
}

function messageRenderSignature(message) {
  return JSON.stringify({
    id: message.id,
    uid: message.uid,
    text: message.text,
    is_admin: message.is_admin,
    replyTo: message.replyTo,
    report: message.report,
    reportedMsgId: message.reportedMsgId,
    galleryId: message.galleryId,
    dm: message.dm,
    deleted: message.deleted,
    edited: message.edited,
    reactions: message.reactions,
    image: message.image,
    imageW: message.imageW,
    imageH: message.imageH,
    createdAt: message.createdAt instanceof Date ? message.createdAt.getTime() : null,
  });
}

function tryAppendNewMessages(previousList, nextList) {
  if (isAdmin || initialLoad || document.querySelector(".search-bar")) return false;
  if (!hasScrolledInitial || previousList.length === 0 || nextList.length <= previousList.length) return false;
  if (previousList.some((message) => message.replyTo || message.report || message.dm)) return false;

  for (let index = 0; index < previousList.length; index++) {
    if (previousList[index].id !== nextList[index]?.id) return false;
    if (messageRenderSignature(previousList[index]) !== messageRenderSignature(nextList[index])) return false;
  }

  const added = nextList.slice(previousList.length);
  if (added.some((message) => message.replyTo || message.report || message.dm)) return false;
  const renderedRows = messagesEl.querySelectorAll(".row[id]");
  if (renderedRows.length !== previousList.length) return false;

  // Consecutive grouped messages change the previous bubble's classes, so use
  // the full renderer for that less common case.
  const previousLast = previousList[previousList.length - 1];
  const firstAdded = added[0];
  const previousCanGroup = previousLast?.is_admin || previousLast?.uid === myUid;
  if (previousCanGroup && previousLast?.uid === firstAdded?.uid) return false;

  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  const anchor = messagesEl.querySelector(".scroll-anchor");
  anchor?.remove();

  added.forEach((message, addedIndex) => {
    const absoluteIndex = previousList.length + addedIndex;
    renderMessage(message, nextList[absoluteIndex - 1] || null, nextList[absoluteIndex + 1] || null, false, null);
  });

  const nextAnchor = anchor || document.createElement("div");
  nextAnchor.className = "scroll-anchor";
  messagesEl.appendChild(nextAnchor);
  prevMessageIds = nextList.filter((message) => !message.report).map((message) => message.id);
  if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  return true;
}

/* ============================================================
   RENDERING  (your original iMessage logic, driven by live data)
   ============================================================ */
function render() {
  // check if user is near the bottom before re-rendering
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  skipNextScroll = false;

  // Identify rows with embeds that haven't changed — we'll preserve them in-place
  const preservedRows = new Map(); // msgId → DOM row
  messagesEl.querySelectorAll(".row[id]").forEach((row) => {
    if (row.querySelector(".embed-twitter, .embed-instagram, .embed-youtube")) {
      const msgId = row.id.replace("msg-", "");
      const msg = messages.find((m) => m.id === msgId);
      if (msg && !msg.deleted && !msg.edited) {
        preservedRows.set(msgId, row);
      }
    }
  });

  // Detach preserved rows before clearing (keeps their iframe state alive)
  preservedRows.forEach((row) => row.remove());

  messagesEl.innerHTML = "";

  // separate top-level messages, replies, and reports
  const topLevel = [];
  const repliesMap = {}; // parentId -> [reply messages]
  const messageIds = new Set(messages.map(m => m.id));

  messages.forEach((m) => {
    if (m.replyTo) {
      if (messageIds.has(m.replyTo)) {
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

    if (preservedRows.has(m.id)) {
      // Re-insert the preserved row (iframe stays alive, no re-init)
      messagesEl.appendChild(preservedRows.get(m.id));
    } else {
      renderMessage(m, prev, next, false, null);
    }

    // render replies stacked below by time
    const replies = repliesMap[m.id];
    if (replies && replies.length > 0) {
      replies.forEach((r, ri) => {
        const rPrev = ri === 0 ? m : replies[ri - 1];
        const rNext = replies[ri + 1] || null;
        if (preservedRows.has(r.id)) {
          messagesEl.appendChild(preservedRows.get(r.id));
        } else {
          renderMessage(r, rPrev, rNext, true, m);
        }
      });
    }
  });

  // only auto-scroll if user was already near the bottom
  if (!hasScrolledInitial) {
    // only reveal when real messages are loaded (not just DMs)
    if (allMessages.length > 0 || !isAdmin) {
      hasScrolledInitial = true;
      requestAnimationFrame(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
        messagesEl.style.visibility = "visible";
        document.querySelector(".skeleton-loading")?.remove();
      });
    }
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
        img.loading = "lazy";
        // reserve space using stored dimensions to prevent layout shift
        if (m.imageW && m.imageH) {
          img.style.aspectRatio = `${m.imageW} / ${m.imageH}`;
          img.style.width = "100%";
        }
        // loading state while image downloads (only for new incoming messages)
        const isRecent = m.createdAt && (Date.now() - m.createdAt.getTime() < 10000);
        if (isRecent) {
          imgWrap.style.display = "none";
          bubble.classList.add("bubble-loading");
          const loadingDots = document.createElement("div");
          loadingDots.className = "typing-dots";
          loadingDots.innerHTML = "<span></span><span></span><span></span>";
          bubble.appendChild(loadingDots);
          img.addEventListener("load", () => {
            imgWrap.style.display = "";
            bubble.classList.remove("bubble-loading");
            loadingDots.remove();
            const pendingCaption = bubble.querySelector("[data-pending-caption]");
            if (pendingCaption) { pendingCaption.style.display = ""; delete pendingCaption.dataset.pendingCaption; }
          });
        }
        // handle load failure with tap-to-retry
        img.addEventListener("error", () => {
          imgWrap.classList.add("img-failed");
          imgWrap.style.aspectRatio = "";
          imgWrap.innerHTML = `<div class="img-placeholder">탭하여 다시 시도</div>`;
          if (bubble.classList.contains("bubble-loading")) {
            bubble.classList.remove("bubble-loading");
            bubble.querySelector(".typing-dots")?.remove();
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
              imgWrap.style.aspectRatio = "";
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
        // gallery item not loaded yet or was deleted
        if (m.galleryId && !galleryItems.some((g) => g.id === m.galleryId)) {
          const isRecent = m.createdAt && (Date.now() - m.createdAt.getTime() < 10000);
          if (isRecent) {
            // still loading — show typing indicator
            bubble.classList.add("bubble-loading");
            const dots = document.createElement("div");
            dots.className = "typing-dots";
            dots.innerHTML = "<span></span><span></span><span></span>";
            bubble.appendChild(dots);
          } else if (m.text) {
            bubble.textContent = m.text;
          } else {
            bubble.textContent = "삭제된 사진입니다";
            bubble.classList.add("deleted");
          }
        } else if (m.text) {
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
        // hide caption while loading dots are showing
        if (bubble.classList.contains("bubble-loading")) {
          caption.style.display = "none";
          caption.dataset.pendingCaption = "true";
        }
        bubble.appendChild(caption);
      }
    } else {
      // detect URLs and make them clickable
      const urlRegex = /(https?:\/\/[^\s]+|(?:www\.|(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|dev|app|co|me|tv|gg|xyz|kr|jp))[^\s]*)/g;
      const twitterRegex = /^https?:\/\/(twitter\.com|x\.com)\/.+\/status\/\d+/i;
      const instagramRegex = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[\w-]+/i;
      const youtubeRegex = /^https?:\/\/(www\.)?(youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]+/i;

      if (m.text.match(urlRegex)) {
        const urls = m.text.match(urlRegex);
        const displayText = m.text.length > 1000 ? m.text.slice(0, 1000) + "…" : m.text;
        appendTextWithLinks(bubble, displayText, urlRegex);
        if (m.text.length > 1000) {
          const moreBtn = document.createElement("button");
          moreBtn.className = "bubble-more-btn";
          moreBtn.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13l5 5 5-5"/><path d="M7 6l5 5 5-5"/></svg>';
          moreBtn.addEventListener("click", (e) => { e.stopPropagation(); showPostOverlay(m.text, m); });
          bubble.appendChild(moreBtn);
        }
        // embed or preview for each URL
        urls.forEach((url) => {
          const fullUrl = url.startsWith("http") ? url : `https://${url}`;
          if (twitterRegex.test(fullUrl)) {
            embedTwitter(fullUrl, bubble);
          } else if (instagramRegex.test(fullUrl)) {
            embedInstagram(fullUrl, bubble);
          } else if (youtubeRegex.test(fullUrl)) {
            embedYouTube(fullUrl, bubble);
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
        if (m.text.length > 1000) {
          bubble.textContent = m.text.slice(0, 1000) + "…";
          const moreBtn = document.createElement("button");
          moreBtn.className = "bubble-more-btn";
          moreBtn.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13l5 5 5-5"/><path d="M7 6l5 5 5-5"/></svg>';
          moreBtn.addEventListener("click", (e) => { e.stopPropagation(); showPostOverlay(m.text, m); });
          bubble.appendChild(moreBtn);
        } else {
          bubble.textContent = m.text;
        }
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
            showDmMenu(e, m, targetBubble, { input, addReaction, showEmojiPicker, doDeleteDm, doUnblock, doBlock, blockedUids, render, banner });
          } else {
            showContextMenu(e, m, side === "sent", targetBubble, { input, addReaction, showEmojiPicker, getActions: (msg) => { const actualIsMe = isAdmin ? msg.uid === "admin" : msg.uid === myUid; return getActions(msg, actualIsMe); } });
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
            showDmMenu(e, m, targetBubble, { input, addReaction, showEmojiPicker, doDeleteDm, doUnblock, doBlock, blockedUids, render, banner });
          } else {
            showContextMenu(e, m, side === "sent", targetBubble, { input, addReaction, showEmojiPicker, getActions: (msg) => { const actualIsMe = isAdmin ? msg.uid === "admin" : msg.uid === myUid; return getActions(msg, actualIsMe); } });
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
        pill.appendChild(document.createTextNode(`${emoji} `));
        const count = document.createElement("span");
        count.className = "reaction-count";
        count.textContent = String(data.count);
        pill.appendChild(count);
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

// load saved channel profile and freeze state — handled by initFromServer in initAuth chain
if (IS_MOCK) {
  const mockName = localStorage.getItem(`mock_channelName_${urlChannel}`);
  if (mockName) document.querySelector(".hdr-name").textContent = mockName;
  const mockImg = localStorage.getItem(`mock_profile_${urlChannel}`);
  if (mockImg) document.querySelector(".hdr-avatar-img").src = mockImg;
}
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
          }, { getChannelPasscode, IS_MOCK });
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
  subscribeCurrentGallery,
  subscribeCurrentDm,
  render,
  debouncedRender,
  banner,
  adminEndLive,
  broadcastLiveStatus,
  subscribeLivePresence,
  broadcastEmoji,
  showConfirmDialog,
});

/* ---- Initialize search module ---- */
initSearch();
configureSearch({
  getMessages: () => messages,
  getAllMessages: () => allMessages,
  searchServer: searchMessages,
  ensureMessageLoaded: async (target) => {
    const targetTime = target.createdAt?.getTime();
    if (!targetTime || allMessages.some((message) => message.id === target.id)) return;
    let attempts = 0;
    while (attempts < 100) {
      if (allMessages.some((message) => message.id === target.id)) break;
      const oldest = allMessages.find((message) => message.createdAt);
      if (!oldest?.createdAt || oldest.createdAt.getTime() <= targetTime) break;
      const older = await loadMoreMessages(oldest.createdAt.toISOString());
      if (older.length === 0) break;
      const byId = new Map(allMessages.map((message) => [message.id, message]));
      older.forEach((message) => byId.set(message.id, message));
      allMessages = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      attempts += 1;
    }
    // Timestamp ties on a page boundary can leave out the exact matched row.
    if (!allMessages.some((message) => message.id === target.id)) {
      allMessages.push(target);
      allMessages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }
    refilterMessages();
    render();
  },
  banner,
  isMock: IS_MOCK,
});

/* ---- Initialize admin panels module ---- */
initAdminPanels({
  urlChannel,
  currentChannelConfig,
  IS_MOCK,
  getState: () => ({ liveActive, inLiveMode, isFrozen }),
  setState: (updates) => {
    if ("liveActive" in updates) liveActive = updates.liveActive;
    if ("inLiveMode" in updates) inLiveMode = updates.inLiveMode;
  },
  adminEndLive,
  adminStartLive,
  adminSetColor,
  adminSetPasscode,
  broadcastLiveStatus,
  enterLiveMode,
  exitLiveMode,
  banner,
  showNoticeInput,
  broadcastRefresh,
  broadcastProfile,
  setFrozen,
  blockedUids: () => blockedUids,
  blockedList: () => blockedList,
  doUnblock,
});

/* ---- Initialize notice module ---- */
initNotice({
  getState: () => ({ inLiveMode, urlChannel }),
  currentChannelConfig,
  subscribeNotice,
  doSetNotice,
  banner,
});

/* ---- Initialize settings module ---- */
initSettings({
  urlChannel,
  currentChannelConfig,
  get isAdmin() { return isAdmin; },
  IS_MOCK,
  adminSetColor,
  showGallery,
  showLinks,
  showAdminPanel,
});

initAuth().then(async (uid) => {
  myUid = uid;
  myNick = anonNameFor(uid);
  if (isAdmin) syncAdminColor();
  // pre-load all initial data in one request before starting subscriptions
  if (!IS_MOCK) {
    const initPromise = initFromServer();
    const timeoutPromise = new Promise(r => setTimeout(() => r(null), 4000));
    const d = await Promise.race([initPromise, timeoutPromise]);
    if (d?.config?.channelName) document.querySelector(".hdr-name").textContent = d.config.channelName;
    if (d?.config?.profileImage) document.querySelector(".hdr-avatar-img").src = d.config.profileImage;
    if (d?.config?.frozen) { isFrozen = true; checkIfBlocked(); }
  }
  showEntryGate();          // always starts, even if init timed out
}).catch((e) => {
  console.error("auth failed", e);
  banner("초기화 실패");
});

/* ============================================================
   CONTEXT MENU  —  iOS-style long-press menu with reactions + actions
   ============================================================ */
let blockedUids = new Set(getBlockedUsers().map(b => b.uid));
let blockedFingerprints = new Set(getBlockedUsers().filter(b => b.fingerprint).map(b => b.fingerprint));
let blockedList = getBlockedUsers();

/* Admin-aware action wrappers */
async function doDeleteMessage(id) {
  // optimistic: remove from local state immediately
  allMessages = allMessages.filter(m => m.id !== id);
  refilterMessages();
  debouncedRender();
  // broadcast to other clients instantly
  broadcastDelete([id]);
  // sync to server
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
  // optimistic: remove from local state immediately
  dmMessages = dmMessages.filter(m => m.id !== id);
  refilterMessages();
  debouncedRender();
  // sync to server
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
  if (isAdmin && msg && msg.galleryId) {
    await doDeleteGallery(msg.galleryId);
  }
  // collect all IDs to delete
  const idsToDelete = [msgId];
  messages.forEach((m) => {
    if (m.replyTo === msgId || m.reportedMsgId === msgId) {
      idsToDelete.push(m.id);
    }
  });
  // optimistic: remove from local state immediately
  const idSet = new Set(idsToDelete);
  allMessages = allMessages.filter(m => !idSet.has(m.id));
  refilterMessages();
  debouncedRender();
  // broadcast to other clients instantly
  broadcastDelete(idsToDelete);
  // sync to server
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
let unreadCount = 0; // new messages while scrolled up

/* ---- Scroll-to-bottom FAB ---- */
messagesEl.addEventListener("scroll", () => {
  const distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  const isAtBottom = distFromBottom < 120;
  scrollBottomBtn.classList.toggle("visible", !isAtBottom);
  if (isAtBottom) {
    unreadCount = 0;
    updateUnreadBadge();
  }
});
scrollBottomBtn.addEventListener("click", () => {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  scrollBottomBtn.classList.remove("visible");
  unreadCount = 0;
  updateUnreadBadge();
});

function updateUnreadBadge() {
  let badge = scrollBottomBtn.querySelector(".unread-badge");
  if (unreadCount > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "unread-badge";
      scrollBottomBtn.appendChild(badge);
    }
    badge.textContent = unreadCount > 99 ? "99+" : unreadCount;
  } else if (badge) {
    badge.remove();
  }
}

function incrementUnread() {
  const distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  if (distFromBottom >= 120) {
    unreadCount++;
    updateUnreadBadge();
  }
}

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
  bar.innerHTML = `<svg class="reply-bar-icon" viewBox="0 0 24 24" width="14" height="14"><path d="M9 4l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h14a4 4 0 0 1 4 4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="reply-bar-text"></span><button class="reply-bar-close">✕</button>`;
  bar.querySelector(".reply-bar-text").textContent = preview;
  bar.querySelector(".reply-bar-close").addEventListener("click", clearReply);
  document.documentElement.style.setProperty("--reply-bar-height", `${bar.getBoundingClientRect().height}px`);
  input.focus();
}

function clearReply() {
  replyingTo = null;
  document.querySelector(".reply-bar")?.remove();
  document.documentElement.style.setProperty("--reply-bar-height", "0px");
}

/* check if current user is blocked and disable composer */
function checkIfBlocked() {
  const blocked = !isAdmin && (blockedUids.has(myUid) || blockedFingerprints.has(myFingerprint));
  const hasPetitioned = localStorage.getItem("petitionSent") === myUid;

  if (!isAdmin && isFrozen && !dmMode) {
    input.disabled = true;
    input.placeholder = "채팅이 얼려져 있습니다 🧊";
    sendBtn.hidden = true;
    document.querySelector(".input-wrap")?.classList.add("frozen-mode");
    document.querySelector(".input-wrap")?.classList.remove("blocked-mode");
    document.querySelector(".input-wrap")?.classList.remove("dm-mode");
    return true;
  }

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
    if (dmMode) {
      input.placeholder = "찍이에게 보내기";
      document.querySelector(".input-wrap")?.classList.add("dm-mode");
      document.querySelector(".input-wrap")?.classList.remove("blocked-mode");
      document.querySelector(".input-wrap")?.classList.remove("frozen-mode");
    } else {
      input.placeholder = isAdmin ? (isFrozen ? "얼려짐 🧊" : "말조심") : "친하게 지내";
      document.querySelector(".input-wrap")?.classList.remove("dm-mode");
      document.querySelector(".input-wrap")?.classList.remove("blocked-mode");
      document.querySelector(".input-wrap")?.classList.remove("frozen-mode");
    }
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
        const savedGallery = await saveToGallery(first.blob);
        msgData.galleryId = savedGallery.id;
        msgData.storedImage = savedGallery.image;
        msgData.imageW = first.dimensions?.width;
        msgData.imageH = first.dimensions?.height;
      }
      await sendMessage(msgData);

      // send remaining photos as separate messages
      for (let i = 1; i < photos.length; i++) {
        const p = photos[i];
        const savedGallery = await saveToGallery(p.blob);
        await sendMessage({ uid: sendUid, nick, text: "", is_admin: isAdmin, adminPasscode: isAdmin ? getAdminPasscode() : null, galleryId: savedGallery.id, storedImage: savedGallery.image, imageW: p.dimensions?.width, imageH: p.dimensions?.height });
      }
    }
    sendTimestamps.push(Date.now());
    if (inLiveMode) {
      input.focus({ preventScroll: true });
    } else {
      input.blur(); // dismiss keyboard outside live mode
    }
    applyPendingAppUpdate();
  }
  catch (e) {
    console.error("send failed", e);
    // restore text on failure
    input.value = savedText;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 80) + "px";
    // restore photos on failure (recreate preview URLs from blobs)
    if (photos.length > 0) {
      pendingPhotos = photos.map(p => ({ ...p, previewUrl: URL.createObjectURL(p.blob) }));
      showMultiPhotoPreview();
    }
    toggleSend();
    if (e.message === "banned") banner("차단되어 전송할 수 없습니다");
    else if (e.message === "rate_limited") banner("너무 빠르게 보내고 있습니다");
    else if (e.message === "banned_word") banner("금지어가 포함되어 전송할 수 없습니다");
    else if (e.message === "frozen") { isFrozen = true; checkIfBlocked(); banner("채팅이 얼려져 있습니다 🧊"); }
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
  showFullImageBase(src, meta, (id, isGalleryId) => {
    if (isGalleryId) {
      // Find the message by galleryId, or load it
      const msg = allMessages.find((m) => m.galleryId === id);
      if (msg) {
        scrollToMessageSilent(msg.id);
      } else {
        // Need to find the message ID for this gallery item
        findMessageByGalleryId(id).then((msgId) => {
          if (msgId) scrollToMessageSilent(msgId);
          else banner("해당 채팅을 찾을 수 없습니다");
        });
      }
    } else {
      scrollToMessageSilent(id);
    }
  });
}

async function findMessageByGalleryId(galleryId) {
  // fetch the message that references this gallery item
  try {
    const res = await fetch(`/api/data?resource=messages&channel_id=${urlChannel}&gallery_id=${galleryId}&limit=1`);
    const data = await res.json();
    const msg = (data.items || [])[0];
    if (msg) return msg.id;
  } catch {}
  return null;
}

function showPostOverlay(fullText, msg) {
  document.querySelector(".post-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "post-overlay";

  const content = document.createElement("div");
  content.className = "post-overlay-content";

  const header = document.createElement("div");
  header.className = "post-overlay-header";
  header.innerHTML = `<span></span><button class="post-overlay-close">✕</button>`;

  const body = document.createElement("div");
  body.className = "post-overlay-body";
  body.textContent = fullText;

  content.appendChild(header);
  content.appendChild(body);
  overlay.appendChild(content);

  overlay.querySelector(".post-overlay-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  document.body.appendChild(overlay);
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
    // message not loaded yet — load history until it appears
    ensureMessageLoadedById(msgId).then((found) => {
      if (found) {
        const target = document.getElementById(`msg-${msgId}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        banner("해당 채팅을 찾을 수 없습니다");
      }
    });
  }
}

async function ensureMessageLoadedById(msgId) {
  if (allMessages.some((m) => m.id === msgId)) return true;
  // find the target message's timestamp by looking in gallery items or fetching it
  const galleryItem = galleryItems.find((g) => g.id === msgId);
  let targetTime = galleryItem?.createdAt?.getTime();

  // if we don't have a timestamp, fetch the message directly
  if (!targetTime) {
    try {
      const res = await fetch(`/api/data?resource=messages&id=${msgId}&channel_id=${urlChannel}`);
      const data = await res.json();
      const msg = data.items?.[0];
      if (!msg) return false;
      targetTime = new Date(msg.created_at).getTime();
    } catch { return false; }
  }

  // load older messages in a loop until we find it
  let attempts = 0;
  while (attempts < 100) {
    if (allMessages.some((m) => m.id === msgId)) break;
    const oldest = allMessages.find((m) => m.createdAt);
    if (!oldest?.createdAt || oldest.createdAt.getTime() <= targetTime) break;
    const older = await loadMoreMessages(oldest.createdAt.toISOString());
    if (older.length === 0) break;
    const byId = new Map(allMessages.map((m) => [m.id, m]));
    older.forEach((m) => byId.set(m.id, m));
    allMessages = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    attempts += 1;
  }

  // check if found after loading
  if (!allMessages.some((m) => m.id === msgId)) {
    // try fetching the specific message and injecting it
    try {
      const res = await fetch(`/api/data?resource=messages&id=${msgId}&channel_id=${urlChannel}`);
      const data = await res.json();
      const msg = data.items?.[0];
      if (msg) {
        const formatted = { ...msg, createdAt: msg.created_at ? new Date(msg.created_at) : null };
        allMessages.push(formatted);
        allMessages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      } else {
        return false;
      }
    } catch { return false; }
  }

  refilterMessages();
  render();
  return true;
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
function subscribeCurrentGallery() {
  if (galleryUnsub) galleryUnsub();
  galleryItems = [];
  galleryLoaded = false;
  galleryUnsub = subscribeGallery((list) => {
    galleryItems = list;
    if (!galleryLoaded) {
      galleryLoaded = true;
      refilterMessages();
      render();
    } else {
      debouncedRender();
    }
  });
}

function subscribeCurrentDm() {
  if (dmUnsub) {
    dmUnsub();
    dmUnsub = null;
  }
  dmMessages = [];
  if (!isAdmin) return;
  dmUnsub = subscribeDm((list) => {
    dmMessages = list;
    if (!initialLoad) {
      const merged = [...allMessages, ...dmMessages.map((d) => ({ ...d, dm: true }))];
      merged.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      messages = merged;
      debouncedRender();
    }
  });
}

async function setFrozen(frozen) {
  isFrozen = frozen;
  checkIfBlocked();
  // broadcast to other clients
  broadcastFreeze(frozen);
  // persist to config table
  if (!IS_MOCK) {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passcode: localStorage.getItem("ap") ? atob(localStorage.getItem("ap")) : "",
        action: "setNotice",
        payload: { text: frozen ? "true" : "", channelId: `frozen_${urlChannel}` }
      }),
    });
  } else {
    localStorage.setItem(`mock_frozen_${urlChannel}`, frozen ? "true" : "");
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
    checkIfBlocked();
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
        setAdminCredential(null);
        location.reload();
      } else {
        const pass = prompt("관리자 비밀번호:");
        if (pass) {
          const valid = IS_MOCK ? true : await verifyAdmin(pass);
          if (valid === true) {
            setAdminPasscode(pass);
            setAdminCredential(pass);
            isAdmin = true;
            localStorage.setItem("isAdmin", "true");
            localStorage.setItem("ap", btoa(pass));
            location.reload();
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

document.querySelector(".hdr-menu")?.addEventListener("click", (e) => {
  showHeaderMenu(e);
});


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
    refreshLivePresence();
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
  subscribeBlocked((list) => { blockedList = list; blockedUids = new Set(list.map(b => b.uid)); blockedFingerprints = new Set(list.filter(b => b.fingerprint).map(b => b.fingerprint)); checkIfBlocked(); refilterMessages(); if (galleryLoaded) render(); });
  subscribe((list) => {
    const previousMessages = messages;
    // count new messages for unread badge
    if (!initialLoad && list.length > allMessages.length) {
      const newCount = list.length - allMessages.length;
      for (let i = 0; i < newCount; i++) incrementUnread();
    }
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
    } else if (tryAppendNewMessages(previousMessages, messages)) {
      // Common fast path: keep existing DOM and append only new rows.
    } else {
      debouncedRender();
    }
  });
  // DMs must load before gallery (gallery triggers first render)
  subscribeCurrentDm();
  subscribeCurrentGallery();
  // subscribe only to the active normal/live channel notice
  subscribeCurrentNotice();
  toggleSend();
  renderNoticeBanner();

  // subscribe to freeze state via config table
  if (IS_MOCK) {
    isFrozen = localStorage.getItem(`mock_frozen_${urlChannel}`) === "true";
    checkIfBlocked();
  }
  // freeze state for non-mock loaded via /api/init on page load

  // init broadcast channel for instant edits + emoji effects
  if (!IS_MOCK) {
    initBroadcast();
    onEditBroadcast(({ id, text, edited }) => {
      const msg = allMessages.find(m => m.id === id);
      if (msg) { msg.text = text; msg.edited = edited; }
      debouncedRender();
    });
    onDeleteBroadcast(({ ids }) => {
      const idSet = new Set(ids);
      const before = allMessages.length;
      allMessages = allMessages.filter(m => !idSet.has(m.id));
      if (allMessages.length !== before) {
        refilterMessages();
        debouncedRender();
      }
    });
    onEmojiBroadcast(({ emoji, x, h }) => {
      spawnEmoji(emoji, x, h);
    });
    onRefreshBroadcast(() => {
      window.location.reload();
    });
    onFreezeBroadcast(({ frozen }) => {
      isFrozen = frozen;
      checkIfBlocked();
      if (!isAdmin) {
        banner(frozen ? "채팅이 얼려졌습니다 🧊" : "채팅이 해제되었습니다", frozen ? "#5B5EA6" : "#34c759");
      }
    });
    onProfileBroadcast(({ name, image }) => {
      if (name) document.querySelector(".hdr-name").textContent = name;
      if (image) document.querySelector(".hdr-avatar-img").src = image;
    });
  }

  // connection status indicator
  if (!IS_MOCK) {
    onConnectionChange((connected) => {
      let indicator = document.querySelector(".connection-banner");
      if (!connected) {
        if (!indicator) {
          indicator = document.createElement("div");
          indicator.className = "connection-banner";
          indicator.textContent = "연결이 끊겼습니다";
          document.querySelector(".chat-header").insertAdjacentElement("afterend", indicator);
        }
      } else {
        if (indicator) {
          indicator.textContent = "다시 연결되었습니다";
          indicator.classList.add("connected");
          setTimeout(() => indicator.remove(), 2000);
        }
      }
    });
  }

  // show "live ended" popup if user was kicked out by admin ending live
  if (localStorage.getItem(`liveEnded_${urlChannel}`)) {
    localStorage.removeItem(`liveEnded_${urlChannel}`);
    showLiveEndedPopup();
  }

  // keep old tabs synchronized with live start/end state
  subscribeLiveStatus(urlChannel, ({ active, title, sessionId }) => {
    liveActive = active;
    localStorage.setItem(`liveActive_${urlChannel}`, active ? "true" : "false");
    if (title) localStorage.setItem(`liveTitle_${urlChannel}`, title);
    const currentSessionId = sessionId || "legacy-active";
    const previousSessionId = localStorage.getItem(`liveSession_${urlChannel}`) || "legacy-active";
    if (active) localStorage.setItem(`liveSession_${urlChannel}`, currentSessionId);

    if (active && inLiveMode && previousSessionId !== currentSessionId) {
      refreshLivePresence();
    }

    // The admin who started the live is already in live mode. Other admin
    // devices should receive the same join prompt as ordinary visitors.
    if (active && !inLiveMode) {
      if (localStorage.getItem(`liveSeen_${urlChannel}`) === currentSessionId) {
        if (!document.querySelector(".live-popup")) showLiveBanner();
      } else {
        showLivePopup();
      }
    } else if (!active) {
      document.querySelector(".live-banner")?.remove();
      document.querySelector(".live-popup:not(.live-ended-popup)")?.remove();
      if (inLiveMode) {
        localStorage.setItem(`liveEnded_${urlChannel}`, "true");
        exitLiveMode();
      }
    }
  });

  // load more messages when scrolling to top
  let loadingMore = false;
  let hasMoreMessages = true;
  messagesEl.addEventListener("scroll", async () => {
    if (messagesEl.scrollTop < 50 && !loadingMore && hasMoreMessages && allMessages.length > 0) {
      const oldest = allMessages.find((m) => m.createdAt);
      if (!oldest || !oldest.createdAt) return;
      loadingMore = true;
      const prevHeight = messagesEl.scrollHeight;
      const prevScrollTop = messagesEl.scrollTop;
      try {
        const older = await loadMoreMessages(oldest.createdAt.toISOString());
        if (older.length < 100) hasMoreMessages = false;
        if (older.length > 0) {
          const byId = new Map(allMessages.map((message) => [message.id, message]));
          older.forEach((message) => byId.set(message.id, message));
          allMessages = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          refilterMessages();
          render();
          // Preserve the item that was at the top of the viewport.
          messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight + prevScrollTop;
        }
      } catch (error) {
        console.warn("older message load failed", error);
        banner("이전 메시지를 불러오지 못했습니다");
      } finally {
        loadingMore = false;
      }
    }
  });

  // re-sync messages when tab becomes visible (handles stale WebSocket)
  let lastVisibilitySync = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !IS_MOCK) {
      const now = Date.now();
      if (now - lastVisibilitySync < 5000) return; // throttle: max once per 5s
      lastVisibilitySync = now;
      fetch(`/api/data?resource=messages&channel_id=${urlChannel}&limit=100`)
        .then(res => res.json())
        .then(data => {
          const fresh = (data.items || []).map(m => ({ ...m, createdAt: m.created_at ? new Date(m.created_at) : null }));
          if (fresh.length > 0) {
            const byId = new Map(allMessages.map(m => [m.id, m]));
            fresh.forEach(m => byId.set(m.id, m));
            const merged = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            if (merged.length !== allMessages.length) {
              allMessages = merged;
              refilterMessages();
              debouncedRender();
            }
          }
        })
        .catch(() => {});
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

/* Reload safely when a newer deployment becomes active. */
let versionCheckRunning = false;
let pendingAppVersion = null;

function applyPendingAppUpdate() {
  if (!pendingAppVersion) return;
  const hasDraft = input.value.length > 0 || pendingPhotos.length > 0 || replyingTo || dmMode;
  if (hasDraft) return;
  window.location.reload();
}

async function checkForAppUpdate() {
  if (__APP_VERSION__ === "local" || versionCheckRunning || document.visibilityState !== "visible") return;
  versionCheckRunning = true;
  try {
    const response = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const { version } = await response.json();
    if (version && version !== "local" && version !== __APP_VERSION__) {
      pendingAppVersion = version;
      applyPendingAppUpdate();
    }
  } catch { /* retry on the next interval */ }
  finally { versionCheckRunning = false; }
}

setInterval(checkForAppUpdate, 60000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForAppUpdate();
});
input.addEventListener("input", applyPendingAppUpdate);
checkForAppUpdate();
