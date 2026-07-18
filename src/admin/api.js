/* ============================================================
   Admin API client — calls Vercel serverless functions
   for admin actions that bypass RLS
   ============================================================ */

let adminPasscode = null;

export function setAdminPasscode(passcode) {
  adminPasscode = passcode;
}

export function getAdminPasscode() {
  return adminPasscode;
}

async function adminCall(action, payload) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode: adminPasscode, action, payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Admin action failed");
  return data;
}

export async function verifyAdmin(passcode) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode, action: "verifyAdmin", payload: {} }),
  });
  if (res.status === 429) return "rate_limited";
  return res.ok;
}

export async function adminDeleteMessage(id) {
  return adminCall("deleteMessage", { id });
}

export async function adminDeleteMessages(ids) {
  return adminCall("deleteMessages", { ids });
}

export async function adminUpdateMessage(id, updates) {
  return adminCall("updateMessage", { id, updates });
}

export async function adminBlock(uid, reason) {
  return adminCall("block", { uid, reason });
}

export async function adminUnblock(uid) {
  return adminCall("unblock", { uid });
}

export async function adminDeleteDm(id) {
  return adminCall("deleteDm", { id });
}

export async function adminDeleteGallery(id) {
  return adminCall("deleteGallery", { id });
}

export async function adminSetNotice(text, channelId) {
  return adminCall("setNotice", { text, channelId });
}

export async function adminSetColor(channelId, color) {
  return adminCall("setColor", { channelId, color });
}

export async function adminGetColor(channelId) {
  try {
    const data = await adminCall("getColor", { channelId });
    return data.color || null;
  } catch { return null; }
}

export async function adminSetPasscode(channelId, hashedPasscode) {
  return adminCall("setPasscode", { channelId, hashedPasscode });
}

export async function adminGetPasscode(channelId) {
  try {
    const data = await adminCall("getPasscode", { channelId });
    return data.hash || null;
  } catch { return null; }
}

export async function adminStartLive(channelId, title) {
  return adminCall("startLive", { channelId, title });
}

export async function adminEndLive(channelId) {
  return adminCall("endLive", { channelId });
}
