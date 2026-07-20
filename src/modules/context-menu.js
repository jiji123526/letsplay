/* ============================================================
   Context Menu Module — iOS-style long-press menu with reactions + actions
   ============================================================ */

export const REACTIONS = ["👍", "👎", "🫪", "❓"];

export const ICONS = {
  reply: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 4l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h14a4 4 0 0 1 4 4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  delete: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  block: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.93 4.93l14.14 14.14" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  report: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 22V15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  unreport: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 4l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

/**
 * Show the context menu overlay for a message bubble.
 * @param {Event} e - triggering event
 * @param {object} msg - message object
 * @param {boolean} isMe - whether the bubble is on the "sent" side
 * @param {HTMLElement} bubbleEl - the bubble DOM element
 * @param {object} deps - { input, addReaction, showEmojiPicker, getActions }
 */
export function showContextMenu(e, msg, isMe, bubbleEl, { input, addReaction, showEmojiPicker, getActions }) {
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
  moreBtn.addEventListener("click", (ev) => {
    const bubbleRect = bubble.getBoundingClientRect();
    closeMenu();
    showEmojiPicker(ev, msg, bubbleRect);
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

  const actions = getActions(msg);
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

/**
 * Show a DM-specific context menu (admin only).
 * @param {Event} e - triggering event
 * @param {object} msg - message object
 * @param {HTMLElement} bubbleEl - the bubble DOM element
 * @param {object} deps - { input, addReaction, showEmojiPicker, doDeleteDm, doUnblock, doBlock, blockedUids, render, banner }
 */
export function showDmMenu(e, msg, bubbleEl, { input, addReaction, showEmojiPicker, doDeleteDm, doUnblock, doBlock, blockedUids, render, banner }) {
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
