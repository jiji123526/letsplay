/* ============================================================
   SUPABASE backend — PostgreSQL + Realtime
   Same interface as firebase-backend.js so app.js doesn't care
   which one is active.
   ============================================================ */

import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "../../config.js";

const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);

let currentUser = null;
let channelId = "main"; // default channel

/* ---- Channel ---- */
export function setChannel(id) { channelId = id; }
export function getChannel() { return channelId; }

/* ---- Auth ---- */
export async function initAuth() {
  // reuse existing session if available (avoids rate limits on refresh)
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
let messageListeners = new Set();

export function subscribe(cb) {
  // initial fetch
  fetchMessages().then(cb);

  // realtime subscription — re-fetch on any change (filter in fetchMessages)
  const channel = supabase
    .channel(`messages-${channelId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
      fetchMessages().then(cb);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

async function fetchMessages() {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true })
    .limit(2000);
  return (data || []).map(formatMessage);
}

export async function loadMoreMessages(beforeDate) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .lt("created_at", beforeDate)
    .order("created_at", { ascending: false })
    .limit(500);
  return (data || []).reverse().map(formatMessage);
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

export async function sendMessage({ uid, nick, text, is_admin, replyTo, report, reportedMsgId, image, dm, galleryId, imageW, imageH, fingerprint }) {
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
      image: imageUrl || null,
      is_admin: !!is_admin,
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
}

export async function removeMessage(id) {
  await supabase.from("messages").delete().eq("id", id);
}

export async function softDeleteMessage(id) {
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, uid: currentUser?.id || "", action: "soft-delete" }),
  });
  if (!res.ok) {
    // fallback for admin (uses adminDeleteMessage separately)
    await supabase.from("messages").update({ deleted: true, text: "", image: null, gallery_id: null }).eq("id", id);
  }
}

export async function editMessage(id, newText) {
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, uid: currentUser?.id || "", action: "edit", text: newText }),
  });
  if (!res.ok) {
    await supabase.from("messages").update({ text: newText, edited: true }).eq("id", id);
  }
}

export async function markReported(id, reported) {
  await supabase.from("messages").update({ reported: !!reported }).eq("id", id);
}

/* ---- Reactions ---- */
export async function addReaction(id, emoji, uid) {
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, uid, action: "react", emoji }),
  });
  if (!res.ok) {
    // fallback direct (for mock mode)
    const { data } = await supabase.from("messages").select("reactions").eq("id", id).single();
    const reactions = data?.reactions || {};
    const key = `${uid}_${emoji.codePointAt(0).toString(16)}`;
    if (reactions[key]) delete reactions[key];
    else reactions[key] = emoji;
    await supabase.from("messages").update({ reactions }).eq("id", id);
  }
}

export async function removeReaction(id, uid) {
  // remove all reactions by this user — fetch, clear, update via API
  const { data } = await supabase.from("messages").select("reactions").eq("id", id).single();
  const reactions = data?.reactions || {};
  Object.keys(reactions).forEach((key) => {
    if (key.startsWith(`${uid}_`)) delete reactions[key];
  });
  const res = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, uid, action: "react-clear" }),
  });
  if (!res.ok) {
    await supabase.from("messages").update({ reactions }).eq("id", id);
  }
}

/* ---- Blocked users ---- */
let _blockedList = [];
let _blockedListeners = new Set();

export function getBlockedUsers() {
  return _blockedList;
}

export function subscribeBlocked(cb) {
  _blockedListeners.add(cb);
  fetchBlocked().then((list) => { _blockedList = list; cb(list); });

  const channel = supabase
    .channel(`blocked-${channelId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "blocked" }, () => {
      fetchBlocked().then((list) => { _blockedList = list; _blockedListeners.forEach((c) => c(list)); });
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); _blockedListeners.delete(cb); };
}

async function fetchBlocked() {
  const { data } = await supabase.from("blocked").select("*").eq("channel_id", channelId);
  return (data || []).map((b) => ({ uid: b.uid, fingerprint: b.fingerprint || "", reason: b.reason || "" }));
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
  let imageUrl = null;
  if (image) {
    imageUrl = await uploadImage(image);
  }
  const res = await fetch("/api/dm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, nick, text, image: imageUrl, channel_id: channelId }),
  });
  if (!res.ok) throw new Error("DM send failed");
}

export async function removeDm(id) {
  await supabase.from("dm").delete().eq("id", id);
}

export function subscribeDm(cb) {
  fetchDm().then(cb);

  const channel = supabase
    .channel(`dm-${channelId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "dm" }, () => {
      fetchDm().then(cb);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

async function fetchDm() {
  const { data } = await supabase.from("dm").select("*").eq("channel_id", channelId).order("created_at", { ascending: true }).limit(500);
  return (data || []).map((row) => ({
    id: row.id,
    uid: row.uid,
    nick: row.nick,
    text: row.text,
    image: row.image,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  }));
}

/* ---- Gallery (uses Supabase Storage for files) ---- */

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
  const imageUrl = await uploadImage(imageBlob);
  const res = await fetch("/api/gallery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageUrl, channel_id: channelId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "gallery save failed");
  return data.id;
}

export function subscribeGallery(cb) {
  fetchGallery().then(cb);

  const channel = supabase
    .channel(`gallery-${channelId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "gallery" }, () => {
      fetchGallery().then(cb);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

async function fetchGallery() {
  const { data } = await supabase.from("gallery").select("*").eq("channel_id", channelId).order("created_at", { ascending: false }).limit(100);
  return (data || []).map((row) => ({
    id: row.id,
    image: row.image,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  }));
}

export async function removeFromGallery(id) {
  const res = await fetch("/api/gallery", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    // fallback direct delete
    const { data } = await supabase.from("gallery").select("image").eq("id", id).single();
    if (data && data.image) {
      const path = data.image.split("/media/")[1];
      if (path) await supabase.storage.from("media").remove([path]);
    }
    await supabase.from("gallery").delete().eq("id", id);
  }
}

/* ---- Notice ---- */
export async function setNotice(text) {
  const noticeId = `notice_${channelId}`;
  await supabase.from("config").upsert({ id: noticeId, text, channel_id: channelId, updated_at: new Date().toISOString() });
}

export function subscribeNotice(cb) {
  fetchNotice().then(cb);

  const noticeId = `notice_${channelId}`;
  const channel = supabase
    .channel(`config-${channelId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "config", filter: `id=eq.${noticeId}` }, () => {
      fetchNotice().then(cb);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

async function fetchNotice() {
  const noticeId = `notice_${channelId}`;
  const { data } = await supabase.from("config").select("text").eq("id", noticeId).single();
  return data?.text || "";
}

/* ---- Search (PostgreSQL full-text search) ---- */
export async function searchMessages(query) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .textSearch("text", query, { type: "websearch" })
    .order("created_at", { ascending: false })
    .limit(50);
  return (data || []).map(formatMessage);
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
  return data?.text === "true";
}
