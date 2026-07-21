/* ============================================================
   SUPABASE backend — PostgreSQL + Realtime
   Same interface as firebase-backend.js so app.js doesn't care
   which one is active.
   ============================================================ */

import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "../../config.js";

const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
const publicRealtime = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
  auth: {
    storageKey: "letsplay-public-realtime",
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

let currentUser = null;
let channelId = "main"; // default channel

/* ---- Connection monitoring ---- */
let connectionListeners = new Set();
let isConnected = true;
let disconnectTimer = null;

export function onConnectionChange(cb) {
  connectionListeners.add(cb);
  return () => connectionListeners.delete(cb);
}

function monitorConnection() {
  // Monitor the publicRealtime socket (used for message signals)
  const socket = publicRealtime.realtime;
  if (!socket) return;

  socket.onOpen(() => {
    if (!isConnected) {
      isConnected = true;
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
      connectionListeners.forEach(cb => cb(true));
    }
  });

  socket.onClose(() => {
    // Only notify after 3 seconds of disconnect (ignore brief blips)
    if (!disconnectTimer) {
      disconnectTimer = setTimeout(() => {
        isConnected = false;
        connectionListeners.forEach(cb => cb(false));
      }, 3000);
    }
  });
}

// Start monitoring after first subscription
setTimeout(monitorConnection, 2000);
let adminCredential = null;
let clientFingerprint = "";

export function setAdminCredential(passcode) { adminCredential = passcode || null; }
export function setClientFingerprint(fingerprint) { clientFingerprint = fingerprint || ""; }

async function requireApiSuccess(res, fallbackMessage) {
  if (res.ok) return;
  let message = fallbackMessage;
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
  } catch { /* response was not JSON */ }
  throw new Error(message);
}

async function authenticatedHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("authentication required");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function fetchPrivateData(resource, params = {}) {
  const search = new URLSearchParams({ resource, channel_id: channelId, uid: currentUser?.id || "", ...params });
  const headers = adminCredential
    ? await authenticatedHeaders()
    : { "Content-Type": "application/json" };
  if (adminCredential) headers["X-Admin-Passcode"] = adminCredential;
  const res = await fetch(`/api/data?${search}`, { headers, cache: "no-store" });
  await requireApiSuccess(res, `${resource} fetch failed`);
  const data = await res.json();
  return data.items || [];
}

/* ---- Channel ---- */
export function setChannel(id) { channelId = id; }
export function getChannel() { return channelId; }

/* ---- Auth ---- */
export async function initAuth() {
  // Ordinary visitors use a stable local identifier and never request a
  // Supabase access token. Only admin mode establishes an authenticated session.
  if (!adminCredential) {
    let localUid = localStorage.getItem("chat_uid");
    if (!localUid) {
      localUid = crypto.randomUUID();
      localStorage.setItem("chat_uid", localUid);
    }
    currentUser = { id: localUid };
    return localUid;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    return currentUser.id;
  }
  // no existing session — anonymous sign-in
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  currentUser = data.user;
  return currentUser.id;
}

/* ---- Messages ---- */
const MESSAGE_PAGE_SIZE = 100;
let messageCache = [];
const messageSignalChannels = new Map();

// Pre-loaded initial data from /api/init (set by initFromServer)
let preloadedData = null;

/**
 * Fetch all initial data in one request and cache it.
 * Subscriptions will use this instead of making separate fetches.
 */
export async function initFromServer() {
  const headers = adminCredential ? await authenticatedHeaders() : {};
  if (adminCredential) headers["X-Admin-Passcode"] = adminCredential;
  try {
    const res = await fetch(`/api/init?channel_id=${encodeURIComponent(channelId)}&limit=${MESSAGE_PAGE_SIZE}`, { headers, cache: "no-store" });
    if (res.ok) {
      preloadedData = await res.json();
    }
  } catch {}
  return preloadedData;
}

function broadcastMessageChange(targetChannel = channelId) {
  const channel = messageSignalChannels.get(targetChannel);
  if (!channel) return;
  channel.send({
    type: "broadcast",
    event: "message-changed",
    payload: { changed: true },
  }).catch((error) => console.warn("message change broadcast failed", error));
}

export function subscribe(cb) {
  const subscribedChannel = channelId;
  let stopped = false;
  let hasConnected = false;
  let recentSyncPromise = null;
  let syncQueued = false;
  let syncDebounceTimer = null;
  let syncMaxWaitTimer = null;
  messageCache = [];

  const publish = () => {
    if (!stopped) cb([...messageCache]);
  };

  const syncRecentMessages = () => {
    if (stopped) return Promise.resolve();
    if (recentSyncPromise) {
      syncQueued = true;
      return recentSyncPromise;
    }
    recentSyncPromise = (preloadedData?.messages
      ? Promise.resolve(preloadedData.messages).then(rows => { preloadedData.messages = null; return rows; })
      : fetchPrivateData("messages", { limit: String(MESSAGE_PAGE_SIZE) })
    )
      .then((rows) => {
        if (stopped) return;
        const recent = rows.map(formatMessage);
        if (recent.length === 0) {
          messageCache = [];
        } else {
          const cutoff = recent[0].createdAt?.getTime() || 0;
          const older = messageCache.filter((message) => {
            const createdAt = message.createdAt?.getTime() || 0;
            return createdAt < cutoff;
          });
          const byId = new Map();
          [...older, ...recent].forEach((message) => byId.set(message.id, message));
          messageCache = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        }
        publish();
      })
      .catch((error) => console.warn("recent message sync failed", error))
      .finally(() => {
        recentSyncPromise = null;
        if (syncQueued && !stopped) {
          syncQueued = false;
          window.setTimeout(syncRecentMessages, 0);
        }
      });
    return recentSyncPromise;
  };

  const flushScheduledSync = () => {
    if (syncDebounceTimer !== null) window.clearTimeout(syncDebounceTimer);
    if (syncMaxWaitTimer !== null) window.clearTimeout(syncMaxWaitTimer);
    syncDebounceTimer = null;
    syncMaxWaitTimer = null;
    syncRecentMessages();
  };

  const scheduleRecentSync = () => {
    if (stopped) return;
    if (syncDebounceTimer !== null) window.clearTimeout(syncDebounceTimer);
    syncDebounceTimer = window.setTimeout(flushScheduledSync, 150);
    if (syncMaxWaitTimer === null) {
      syncMaxWaitTimer = window.setTimeout(flushScheduledSync, 500);
    }
  };

  const initialFetch = fetchMessages().then((list) => {
    if (stopped) return;
    messageCache = list;
    publish();
  });

  // Realtime is only a lightweight invalidation signal. Fetch the changed
  // row through the safe API instead of downloading the whole history again.
  const channel = supabase
    .channel(`messages-${subscribedChannel}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "messages",
      filter: `channel_id=eq.${subscribedChannel}`,
    }, async (payload) => {
      try {
        await initialFetch.catch(() => {});
        const id = payload.new?.id || payload.old?.id;
        if (!id) return;
        if (payload.eventType === "DELETE") {
          messageCache = messageCache.filter((message) => message.id !== id);
        } else {
          const rows = await fetchPrivateData("messages", { id, limit: "1" });
          const changed = rows[0] ? formatMessage(rows[0]) : null;
          const index = messageCache.findIndex((message) => message.id === id);
          if (!changed) {
            if (index >= 0) messageCache.splice(index, 1);
          } else if (index >= 0) {
            messageCache[index] = changed;
          } else {
            messageCache.push(changed);
          }
          messageCache.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        }
        publish();
      } catch (error) {
        console.warn("realtime message update failed", error);
        await syncRecentMessages();
      }
    })
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (hasConnected) syncRecentMessages();
      hasConnected = true;
    });

  // Ordinary visitors do not have a Supabase auth token, so RLS may suppress
  // postgres_changes events. Broadcast carries only an invalidation signal;
  // message data is still fetched through the protected API above.
  const signalChannel = publicRealtime
    .channel(`message-signals-${subscribedChannel}`, { config: { broadcast: { self: true } } })
    .on("broadcast", { event: "message-changed" }, () => {
      scheduleRecentSync();
    })
    .subscribe();
  messageSignalChannels.set(subscribedChannel, signalChannel);

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") syncRecentMessages();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  const syncIntervalMs = subscribedChannel.endsWith("_live")
    ? 45_000 + Math.floor(Math.random() * 15_001)
    : 5 * 60 * 1000;
  const syncTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") syncRecentMessages();
  }, syncIntervalMs);

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.clearInterval(syncTimer);
    if (syncDebounceTimer !== null) window.clearTimeout(syncDebounceTimer);
    if (syncMaxWaitTimer !== null) window.clearTimeout(syncMaxWaitTimer);
    supabase.removeChannel(channel);
    if (messageSignalChannels.get(subscribedChannel) === signalChannel) {
      messageSignalChannels.delete(subscribedChannel);
    }
    publicRealtime.removeChannel(signalChannel);
  };
}

/* ---- Broadcast channel for instant updates ---- */
let broadcastChannel = null;
let editListeners = new Set();
let deleteListeners = new Set();
let refreshListeners = new Set();
let freezeListeners = new Set();
let profileListeners = new Set();
let emojiListeners = new Set();
let dmChangeListeners = new Set();

export function initBroadcast() {
  if (broadcastChannel) supabase.removeChannel(broadcastChannel);
  broadcastChannel = supabase
    .channel(`broadcast-${channelId}`, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "msg-edit" }, ({ payload }) => {
      editListeners.forEach(cb => cb(payload));
    })
    .on("broadcast", { event: "msg-delete" }, ({ payload }) => {
      deleteListeners.forEach(cb => cb(payload));
    })
    .on("broadcast", { event: "force-refresh" }, () => {
      refreshListeners.forEach(cb => cb());
    })
    .on("broadcast", { event: "freeze-change" }, ({ payload }) => {
      freezeListeners.forEach(cb => cb(payload));
    })
    .on("broadcast", { event: "profile-change" }, ({ payload }) => {
      profileListeners.forEach(cb => cb(payload));
    })
    .on("broadcast", { event: "emoji-fx" }, ({ payload }) => {
      emojiListeners.forEach(cb => cb(payload));
    })
    .on("broadcast", { event: "dm-changed" }, () => {
      dmChangeListeners.forEach(cb => cb());
    })
    .subscribe();
}

export function onEditBroadcast(cb) {
  editListeners.add(cb);
  return () => editListeners.delete(cb);
}

export function onEmojiBroadcast(cb) {
  emojiListeners.add(cb);
  return () => emojiListeners.delete(cb);
}

export function broadcastEdit(id, text) {
  if (broadcastChannel) {
    broadcastChannel.send({
      type: "broadcast",
      event: "msg-edit",
      payload: { id, text, edited: true },
    });
  }
}

export function onDeleteBroadcast(cb) {
  deleteListeners.add(cb);
  return () => deleteListeners.delete(cb);
}

export function broadcastDelete(ids) {
  if (broadcastChannel) {
    broadcastChannel.send({
      type: "broadcast",
      event: "msg-delete",
      payload: { ids },
    });
  }
}

export function onRefreshBroadcast(cb) {
  refreshListeners.add(cb);
  return () => refreshListeners.delete(cb);
}

export function broadcastRefresh() {
  if (broadcastChannel) {
    broadcastChannel.send({
      type: "broadcast",
      event: "force-refresh",
      payload: {},
    });
  }
}

export function onFreezeBroadcast(cb) {
  freezeListeners.add(cb);
  return () => freezeListeners.delete(cb);
}

export function broadcastFreeze(frozen) {
  if (broadcastChannel) {
    broadcastChannel.send({
      type: "broadcast",
      event: "freeze-change",
      payload: { frozen },
    });
  }
}

export function onProfileBroadcast(cb) {
  profileListeners.add(cb);
  return () => profileListeners.delete(cb);
}

export function broadcastProfile(profile) {
  if (broadcastChannel) {
    broadcastChannel.send({
      type: "broadcast",
      event: "profile-change",
      payload: profile,
    });
  }
}

export function broadcastEmoji(emoji, x, h) {
  if (broadcastChannel) {
    broadcastChannel.send({
      type: "broadcast",
      event: "emoji-fx",
      payload: { emoji, x, h },
    });
  }
}

async function fetchMessages() {
  const data = await fetchPrivateData("messages", { limit: String(MESSAGE_PAGE_SIZE) });
  return data.map(formatMessage);
}

export async function loadMoreMessages(beforeDate) {
  const data = await fetchPrivateData("messages", { before: beforeDate, limit: String(MESSAGE_PAGE_SIZE) });
  const older = data.map(formatMessage);
  const byId = new Map(messageCache.map((message) => [message.id, message]));
  older.forEach((message) => byId.set(message.id, message));
  messageCache = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return older;
}

function formatMessage(row) {
  return {
    id: row.id,
    uid: row.uid,
    authUid: row.auth_uid,
    nick: row.nick,
    text: row.text,
    is_admin: row.is_admin,
    image: row.image || null,
    imageW: row.image_w || null,
    imageH: row.image_h || null,
    fingerprint: row.fingerprint || null,
    replyTo: row.reply_to,
    report: row.report,
    reportedMsgId: row.reported_msg_id,
    galleryId: row.gallery_id,
    dm: row.dm,
    deleted: row.deleted,
    edited: row.edited,
    reactions: row.reactions || {},
    reported: row.reported,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  };
}

export async function sendMessage({ uid, nick, text, is_admin, adminPasscode, replyTo, report, reportedMsgId, image, storedImage, dm, galleryId, imageW, imageH, fingerprint }) {
  const targetChannel = channelId;
  // upload image first if present (direct to storage)
  let imageUrl = null;
  if (image) {
    imageUrl = await uploadImage(image);
  }

  // route message through server API for validation
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uid,
      nick,
      text: text || "",
      image: imageUrl || storedImage || null,
      is_admin: !!is_admin,
      admin_passcode: is_admin ? adminPasscode || null : null,
      channel_id: channelId,
      fingerprint: fingerprint || null,
      reply_to: replyTo || null,
      report: report || false,
      reported_msg_id: reportedMsgId || null,
      image_w: imageW || null,
      image_h: imageH || null,
      gallery_id: galleryId || null,
      dm: dm || false,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "send failed");
  broadcastMessageChange(targetChannel);
}

export async function removeMessage(id) {
  const targetChannel = channelId;
  const res = await fetch("/api/messages", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, uid: currentUser?.id || "", channel_id: channelId }),
  });
  await requireApiSuccess(res, "message delete failed");
  broadcastMessageChange(targetChannel);
}

export async function softDeleteMessage(id) {
  const targetChannel = channelId;
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, uid: currentUser?.id || "", action: "soft-delete" }),
  });
  await requireApiSuccess(res, "message delete failed");
  broadcastMessageChange(targetChannel);
}

export async function editMessage(id, newText) {
  const targetChannel = channelId;
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, uid: currentUser?.id || "", action: "edit", text: newText }),
  });
  await requireApiSuccess(res, "message edit failed");
  broadcastMessageChange(targetChannel);
}

/* ---- Reactions ---- */
export async function addReaction(id, emoji, uid) {
  const targetChannel = channelId;
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, uid, action: "react", emoji }),
  });
  await requireApiSuccess(res, "reaction update failed");
  broadcastMessageChange(targetChannel);
}

export async function removeReaction(id, uid) {
  const targetChannel = channelId;
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, uid, action: "react-clear" }),
  });
  await requireApiSuccess(res, "reaction clear failed");
  broadcastMessageChange(targetChannel);
}

/* ---- Blocked users ---- */
let _blockedList = [];
let _blockedListeners = new Set();

export function getBlockedUsers() {
  return _blockedList;
}

export function subscribeBlocked(cb) {
  const subscribedChannel = channelId;
  _blockedListeners.add(cb);
  const blockedPromise = preloadedData?.blocked
    ? Promise.resolve(preloadedData.blocked.map(b => ({ uid: b.uid, fingerprint: b.fingerprint || "", reason: b.reason || "" }))).then(d => { preloadedData.blocked = null; return d; })
    : fetchBlocked();
  blockedPromise.then((list) => { _blockedList = list; cb(list); });

  const channel = supabase
    .channel(`blocked-${subscribedChannel}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "blocked", filter: `channel_id=eq.${subscribedChannel}` }, () => {
      fetchBlocked().then((list) => { _blockedList = list; _blockedListeners.forEach((c) => c(list)); });
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); _blockedListeners.delete(cb); };
}

async function fetchBlocked() {
  const data = await fetchPrivateData("blocked", { fingerprint: clientFingerprint });
  return data.map((b) => ({ uid: b.uid, fingerprint: b.fingerprint || "", reason: b.reason || "" }));
}

export async function blockUser(uid, reason, fingerprint) {
  const row = { uid, reason: reason || "", channel_id: channelId };
  if (fingerprint) row.fingerprint = fingerprint;
  await supabase.from("blocked").insert(row);
}

export async function unblockUser(uid) {
  await supabase.from("blocked").delete().eq("uid", uid).eq("channel_id", channelId);
}

/* ---- DM ---- */
export async function sendDm({ uid, nick, text, image, imageW, imageH }) {
  const targetChannel = channelId;
  let imageUrl = null;
  if (image) {
    imageUrl = await uploadImage(image);
  }
  const res = await fetch("/api/dm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, nick, text, image: imageUrl, channel_id: targetChannel }),
  });
  if (!res.ok) throw new Error("DM send failed");
  if (broadcastChannel) {
    broadcastChannel.send({
      type: "broadcast",
      event: "dm-changed",
      payload: { changed: true },
    }).catch((error) => console.warn("DM change broadcast failed", error));
  }
}

export async function removeDm(id) {
  await supabase.from("dm").delete().eq("id", id);
}

export function subscribeDm(cb) {
  const subscribedChannel = channelId;
  let dmCache = [];
  let stopped = false;
  let fetchPromise = null;
  let syncQueued = false;
  const syncDm = () => {
    if (stopped) return Promise.resolve();
    if (fetchPromise) {
      syncQueued = true;
      return fetchPromise;
    }
    fetchPromise = (preloadedData?.dm
      ? Promise.resolve(preloadedData.dm.map(formatDm)).then(d => { preloadedData.dm = null; return d; })
      : fetchDm(subscribedChannel)
    ).then((list) => {
      if (stopped) return;
      dmCache = list;
      cb([...dmCache]);
    }).catch((error) => console.warn("DM sync failed", error))
      .finally(() => {
        fetchPromise = null;
        if (syncQueued && !stopped) {
          syncQueued = false;
          window.setTimeout(syncDm, 0);
        }
      });
    return fetchPromise;
  };
  const initialFetch = syncDm();

  const channel = supabase
    .channel(`dm-${subscribedChannel}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "dm", filter: `channel_id=eq.${subscribedChannel}` }, async (payload) => {
      await initialFetch.catch(() => {});
      if (stopped) return;
      const row = payload.new;
      const id = row?.id || payload.old?.id;
      if (!id) return;
      const index = dmCache.findIndex((item) => item.id === id);
      if (payload.eventType === "DELETE") {
        if (index >= 0) dmCache.splice(index, 1);
      } else {
        const changed = formatDm(row);
        if (index >= 0) dmCache[index] = changed;
        else dmCache.push(changed);
        dmCache.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      }
      cb([...dmCache]);
    })
    .subscribe();

  dmChangeListeners.add(syncDm);

  return () => {
    stopped = true;
    dmChangeListeners.delete(syncDm);
    supabase.removeChannel(channel);
  };
}

async function fetchDm(targetChannel = channelId) {
  const data = await fetchPrivateData("dm", { channel_id: targetChannel });
  return data.map(formatDm);
}

function formatDm(row) {
  return {
    id: row.id,
    uid: row.uid,
    nick: row.nick,
    text: row.text,
    image: row.image,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  };
}

/* ---- Gallery (uses Supabase Storage for files) ---- */

const gallerySignalChannels = new Map();

function broadcastGalleryChange(targetChannel = channelId) {
  const channel = gallerySignalChannels.get(targetChannel);
  if (!channel) return;
  channel.send({
    type: "broadcast",
    event: "gallery-changed",
    payload: { changed: true },
  }).catch((error) => console.warn("gallery change broadcast failed", error));
}

async function uploadImage(blob) {
  const ext = blob.type === "image/gif" ? "gif" : "jpg";
  const fileName = `${channelId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const filePath = `photos/${fileName}`;

  const { error } = await supabase.storage.from("media").upload(filePath, blob, {
    contentType: blob.type,
    cacheControl: "3600",
  });
  if (error) throw error;

  const { data } = supabase.storage.from("media").getPublicUrl(filePath);
  return data.publicUrl;
}

export async function saveToGallery(imageBlob) {
  const targetChannel = channelId;
  const imageUrl = await uploadImage(imageBlob);
  const res = await fetch("/api/gallery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: currentUser?.id || "", image: imageUrl, channel_id: targetChannel }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "gallery save failed");
  broadcastGalleryChange(targetChannel);
  return { id: data.id, image: imageUrl };
}

export function subscribeGallery(cb) {
  const subscribedChannel = channelId;
  let galleryCache = [];
  let stopped = false;
  let fetchPromise = null;
  let syncQueued = false;
  const syncGallery = () => {
    if (stopped) return Promise.resolve();
    if (fetchPromise) {
      syncQueued = true;
      return fetchPromise;
    }
    fetchPromise = (preloadedData?.gallery
      ? Promise.resolve(preloadedData.gallery.map(formatGalleryItem)).then(d => { preloadedData.gallery = null; return d; })
      : fetchGallery(subscribedChannel)
    ).then((list) => {
      if (stopped) return;
      galleryCache = list;
      cb([...galleryCache]);
    }).catch((error) => console.warn("gallery sync failed", error))
      .finally(() => {
        fetchPromise = null;
        if (syncQueued && !stopped) {
          syncQueued = false;
          window.setTimeout(syncGallery, 0);
        }
      });
    return fetchPromise;
  };
  const initialFetch = syncGallery();

  const channel = supabase
    .channel(`gallery-${subscribedChannel}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "gallery", filter: `channel_id=eq.${subscribedChannel}` }, async (payload) => {
      await initialFetch.catch(() => {});
      if (stopped) return;
      const row = payload.new;
      const id = row?.id || payload.old?.id;
      if (!id) return;
      const index = galleryCache.findIndex((item) => item.id === id);
      if (payload.eventType === "DELETE") {
        if (index >= 0) galleryCache.splice(index, 1);
      } else {
        const changed = formatGalleryItem(row);
        if (index >= 0) galleryCache[index] = changed;
        else galleryCache.push(changed);
        galleryCache.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        galleryCache = galleryCache.slice(0, 100);
      }
      cb([...galleryCache]);
    })
    .subscribe();

  const signalChannel = publicRealtime
    .channel(`gallery-signals-${subscribedChannel}`, { config: { broadcast: { self: true } } })
    .on("broadcast", { event: "gallery-changed" }, syncGallery)
    .subscribe();
  gallerySignalChannels.set(subscribedChannel, signalChannel);

  return () => {
    stopped = true;
    supabase.removeChannel(channel);
    if (gallerySignalChannels.get(subscribedChannel) === signalChannel) {
      gallerySignalChannels.delete(subscribedChannel);
    }
    publicRealtime.removeChannel(signalChannel);
  };
}

async function fetchGallery(targetChannel = channelId) {
  const data = await fetchPrivateData("gallery", { channel_id: targetChannel });
  return data.map(formatGalleryItem);
}

function formatGalleryItem(row) {
  return {
    id: row.id,
    image: row.image,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  };
}

export async function removeFromGallery(id) {
  const res = await fetch("/api/gallery", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  await requireApiSuccess(res, "gallery delete failed");
}

/* ---- Notice ---- */
export async function setNotice(text) {
  const noticeId = `notice_${channelId}`;
  await supabase.from("config").upsert({ id: noticeId, text, channel_id: channelId, updated_at: new Date().toISOString() });
}

export function subscribeNotice(cb) {
  const noticeId = `notice_${channelId}`;
  let active = true;
  const fetchSubscribedNotice = async () => {
    const { data } = await supabase.from("config").select("text").eq("id", noticeId).maybeSingle();
    if (active) cb(data?.text || "");
  };
  // use preloaded notice if available
  if (preloadedData?.config?.notice !== undefined) {
    cb(preloadedData.config.notice || "");
    preloadedData.config.notice = undefined;
  } else {
    fetchSubscribedNotice();
  }

  const channel = supabase
    .channel(`config-${channelId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "config", filter: `id=eq.${noticeId}` }, () => {
      fetchSubscribedNotice();
    })
    .subscribe();

  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}

/* ---- Search (PostgreSQL full-text search) ---- */
export async function searchMessages(query) {
  const data = await fetchPrivateData("search", { q: query });
  return data.map(formatMessage);
}

/* ---- Passcode (public read) ---- */
export async function getChannelPasscode(chId) {
  const passcodeId = `passcode_${chId || "main"}`;
  const { data } = await supabase.from("config").select("text").eq("id", passcodeId).single();
  return data?.text || null;
}

/* ---- Live mode (public read) ---- */
export async function getLiveStatus(chId) {
  const liveId = `live_${chId || "main"}`;
  const { data } = await supabase.from("config").select("text").eq("id", liveId).single();
  return parseLiveStatus(data?.text).active;
}

function parseLiveStatus(text) {
  if (!text) return { active: false, title: "", sessionId: "" };
  try {
    const value = JSON.parse(text);
    if (typeof value === "object" && value !== null) {
      return { active: value.active === true, title: value.title || "", sessionId: value.sessionId || "" };
    }
  } catch { /* legacy true/false value */ }
  return { active: text === "true", title: "", sessionId: "" };
}

const liveStatusChannels = new Map();

export function subscribeLiveStatus(chId, cb) {
  const subscribedChannel = chId || "main";
  let active = true;
  let fetchPromise = null;
  const fetchStatus = async () => {
    if (!active || fetchPromise) return fetchPromise;
    fetchPromise = fetch(`/api/data?resource=live_status&channel_id=${encodeURIComponent(subscribedChannel)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("live status fetch failed");
        const data = await response.json();
        if (active) cb(data.items?.[0] || { active: false, title: "", sessionId: "" });
      })
      .catch((error) => console.warn("live status sync failed", error))
      .finally(() => { fetchPromise = null; });
    return fetchPromise;
  };
  // use preloaded live status if available
  if (preloadedData?.config?.liveStatus) {
    cb(preloadedData.config.liveStatus);
    preloadedData.config.liveStatus = undefined;
  } else {
    fetchStatus();
  }
  const channel = publicRealtime
    .channel(`live-signal-${subscribedChannel}`)
    .on("broadcast", { event: "status-changed" }, fetchStatus)
    .subscribe();
  liveStatusChannels.set(subscribedChannel, channel);
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") fetchStatus();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const syncTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") fetchStatus();
  }, 60000);
  return () => {
    active = false;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.clearInterval(syncTimer);
    if (liveStatusChannels.get(subscribedChannel) === channel) {
      liveStatusChannels.delete(subscribedChannel);
    }
    publicRealtime.removeChannel(channel);
  };
}

export function broadcastLiveStatus(chId) {
  const channel = liveStatusChannels.get(chId || "main");
  if (!channel) return;
  channel.send({ type: "broadcast", event: "status-changed", payload: {} });
}

export function subscribeLivePresence(chId, cb) {
  const tabId = crypto.randomUUID();
  const channel = publicRealtime.channel(`live-presence-${chId || "main"}`, {
    config: { presence: { key: tabId } },
  });
  let active = true;

  channel
    .on("presence", { event: "sync" }, () => {
      if (!active) return;
      const count = Object.values(channel.presenceState())
        .reduce((total, entries) => total + entries.length, 0);
      cb(count);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED" && active) {
        await channel.track({ joined_at: new Date().toISOString() });
      }
    });

  return () => {
    active = false;
    channel.untrack();
    publicRealtime.removeChannel(channel);
  };
}
