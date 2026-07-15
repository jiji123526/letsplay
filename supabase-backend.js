/* ============================================================
   SUPABASE backend — PostgreSQL + Realtime
   Same interface as firebase-backend.js so app.js doesn't care
   which one is active.
   ============================================================ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { supabaseConfig } from "./config.js";

const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);

let currentUser = null;

/* ---- Auth ---- */
export async function initAuth() {
  // anonymous sign-in
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

  // realtime subscription
  const channel = supabase
    .channel("messages")
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
    .order("created_at", { ascending: true })
    .limit(500);
  return (data || []).map(formatMessage);
}

function formatMessage(row) {
  return {
    id: row.id,
    uid: row.uid,
    authUid: row.auth_uid,
    nick: row.nick,
    text: row.text,
    is_admin: row.is_admin,
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

export async function sendMessage({ uid, nick, text, is_admin, replyTo, report, reportedMsgId, image, dm, galleryId }) {
  const authUid = currentUser.id;
  const row = { uid, auth_uid: authUid, nick, text, is_admin: !!is_admin, created_at: new Date().toISOString() };
  if (replyTo) row.reply_to = replyTo;
  if (report) { row.report = true; row.reported_msg_id = reportedMsgId || null; }
  if (image) {
    // upload image to storage and store URL
    const imageUrl = await uploadImage(image);
    row.image = imageUrl;
  }
  if (dm) row.dm = true;
  if (galleryId) row.gallery_id = galleryId;
  const { error } = await supabase.from("messages").insert(row);
  if (error) throw error;
}

export async function removeMessage(id) {
  await supabase.from("messages").delete().eq("id", id);
}

export async function softDeleteMessage(id) {
  await supabase.from("messages").update({ deleted: true, text: "" }).eq("id", id);
}

export async function editMessage(id, newText) {
  await supabase.from("messages").update({ text: newText, edited: true }).eq("id", id);
}

export async function markReported(id, reported) {
  await supabase.from("messages").update({ reported: !!reported }).eq("id", id);
}

/* ---- Reactions ---- */
export async function addReaction(id, emoji, uid) {
  const { data } = await supabase.from("messages").select("reactions").eq("id", id).single();
  const reactions = data?.reactions || {};
  const key = `${uid}_${emoji.codePointAt(0).toString(16)}`;
  if (reactions[key]) {
    delete reactions[key];
  } else {
    reactions[key] = emoji;
  }
  await supabase.from("messages").update({ reactions }).eq("id", id);
}

export async function removeReaction(id, uid) {
  const { data } = await supabase.from("messages").select("reactions").eq("id", id).single();
  const reactions = data?.reactions || {};
  Object.keys(reactions).forEach((key) => {
    if (key.startsWith(`${uid}_`)) delete reactions[key];
  });
  await supabase.from("messages").update({ reactions }).eq("id", id);
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
    .channel("blocked")
    .on("postgres_changes", { event: "*", schema: "public", table: "blocked" }, () => {
      fetchBlocked().then((list) => { _blockedList = list; _blockedListeners.forEach((c) => c(list)); });
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); _blockedListeners.delete(cb); };
}

async function fetchBlocked() {
  const { data } = await supabase.from("blocked").select("*");
  return (data || []).map((b) => ({ uid: b.uid, reason: b.reason || "" }));
}

export async function blockUser(uid, reason) {
  await supabase.from("blocked").insert({ uid, reason: reason || "" });
}

export async function unblockUser(uid) {
  await supabase.from("blocked").delete().eq("uid", uid);
}

/* ---- DM ---- */
export async function sendDm({ uid, nick, text, image }) {
  const authUid = currentUser.id;
  const row = { uid, auth_uid: authUid, nick, text, created_at: new Date().toISOString() };
  if (image) {
    const imageUrl = await uploadImage(image);
    row.image = imageUrl;
  }
  await supabase.from("dm").insert(row);
}

export async function removeDm(id) {
  await supabase.from("dm").delete().eq("id", id);
}

export function subscribeDm(cb) {
  fetchDm().then(cb);

  const channel = supabase
    .channel("dm")
    .on("postgres_changes", { event: "*", schema: "public", table: "dm" }, () => {
      fetchDm().then(cb);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

async function fetchDm() {
  const { data } = await supabase.from("dm").select("*").order("created_at", { ascending: true }).limit(500);
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

async function uploadImage(dataUrl) {
  // convert base64 data URL to blob
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = blob.type === "image/gif" ? "gif" : "jpg";
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const filePath = `photos/${fileName}`;

  const { error } = await supabase.storage.from("media").upload(filePath, blob, {
    contentType: blob.type,
    cacheControl: "3600",
  });
  if (error) throw error;

  // get public URL
  const { data } = supabase.storage.from("media").getPublicUrl(filePath);
  return data.publicUrl;
}

export async function saveToGallery(imageDataUrl) {
  // upload to storage, save URL in gallery table
  const imageUrl = await uploadImage(imageDataUrl);
  const { data, error } = await supabase.from("gallery").insert({ image: imageUrl }).select("id").single();
  if (error) throw error;
  return data.id;
}

export function subscribeGallery(cb) {
  fetchGallery().then(cb);

  const channel = supabase
    .channel("gallery")
    .on("postgres_changes", { event: "*", schema: "public", table: "gallery" }, () => {
      fetchGallery().then(cb);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

async function fetchGallery() {
  const { data } = await supabase.from("gallery").select("*").order("created_at", { ascending: false }).limit(100);
  return (data || []).map((row) => ({
    id: row.id,
    image: row.image,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  }));
}

export async function removeFromGallery(id) {
  // get the image URL to delete from storage too
  const { data } = await supabase.from("gallery").select("image").eq("id", id).single();
  if (data && data.image) {
    const path = data.image.split("/media/")[1];
    if (path) await supabase.storage.from("media").remove([path]);
  }
  await supabase.from("gallery").delete().eq("id", id);
}

/* ---- Notice ---- */
export async function setNotice(text) {
  // upsert into config table
  await supabase.from("config").upsert({ id: "notice", text, updated_at: new Date().toISOString() });
}

export function subscribeNotice(cb) {
  fetchNotice().then(cb);

  const channel = supabase
    .channel("config")
    .on("postgres_changes", { event: "*", schema: "public", table: "config", filter: "id=eq.notice" }, () => {
      fetchNotice().then(cb);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

async function fetchNotice() {
  const { data } = await supabase.from("config").select("text").eq("id", "notice").single();
  return data?.text || "";
}

/* ---- Search (PostgreSQL full-text search) ---- */
export async function searchMessages(query) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .textSearch("text", query, { type: "websearch" })
    .order("created_at", { ascending: false })
    .limit(50);
  return (data || []).map(formatMessage);
}
