import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Uses service role key — full access, bypasses RLS
const supabase = createClient(
  process.env.SUPABASE_URL || "https://wpwlqpkawssrywlqgncg.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

// Rate limit: max 10 failed attempts per IP per hour
const failedAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW = 60 * 60 * 1000; // 1 hour

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const attempts = failedAttempts.get(ip) || [];
  const recent = attempts.filter(t => now - t < WINDOW);
  failedAttempts.set(ip, recent);
  return recent.length >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const attempts = failedAttempts.get(ip) || [];
  attempts.push(Date.now());
  failedAttempts.set(ip, attempts);
}

function getMediaStoragePath(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    const marker = "/storage/v1/object/public/media/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

async function removeMediaFiles(paths) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  for (let index = 0; index < uniquePaths.length; index += 100) {
    const { error } = await supabase.storage.from("media").remove(uniquePaths.slice(index, index + 100));
    if (error) throw error;
  }
}

async function deleteWhere(table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error) throw error;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { passcode, action, payload } = req.body;
  const clientIp = getClientIp(req);

  // rate limit check
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: "그만해라" });
  }

  // verify admin passcode
  if (passcode !== process.env.ADMIN_PASSCODE) {
    recordFailedAttempt(clientIp);
    return res.status(403).json({ error: "Invalid passcode" });
  }

  try {
    switch (action) {
      case "deleteMessage": {
        const { id } = payload;
        const { error } = await supabase.from("messages").delete().eq("id", id);
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "deleteMessages": {
        // delete multiple (for deleteMessageWithReplies)
        const { ids } = payload;
        for (const id of ids) {
          await supabase.from("messages").delete().eq("id", id);
        }
        return res.json({ ok: true });
      }

      case "updateMessage": {
        const { id, updates } = payload;
        const { error } = await supabase.from("messages").update(updates).eq("id", id);
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "block": {
        const { uid, reason } = payload;
        const { error } = await supabase.from("blocked").insert({ uid, reason: reason || "" });
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "unblock": {
        const { uid } = payload;
        const { error } = await supabase.from("blocked").delete().eq("uid", uid);
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "deleteDm": {
        const { id } = payload;
        const { error } = await supabase.from("dm").delete().eq("id", id);
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "deleteGallery": {
        const { id } = payload;
        // get image URL to delete from storage
        const { data } = await supabase.from("gallery").select("image").eq("id", id).single();
        if (data && data.image) {
          const path = data.image.split("/media/")[1];
          if (path) await supabase.storage.from("media").remove([path]);
        }
        const { error } = await supabase.from("gallery").delete().eq("id", id);
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "setNotice": {
        const { text, channelId } = payload;
        const noticeId = `notice_${channelId || "main"}`;
        const { error } = await supabase.from("config").upsert({ id: noticeId, text, channel_id: channelId || "main", updated_at: new Date().toISOString() });
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "setColor": {
        const { channelId, color } = payload;
        const colorId = `adminColor_${channelId || "main"}`;
        const { error } = await supabase.from("config").upsert({ id: colorId, text: color, channel_id: channelId || "main", updated_at: new Date().toISOString() });
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "getColor": {
        const { channelId } = payload;
        const colorId = `adminColor_${channelId || "main"}`;
        const { data } = await supabase.from("config").select("text").eq("id", colorId).single();
        return res.json({ ok: true, color: data?.text || null });
      }

      case "setPasscode": {
        const { channelId, hashedPasscode } = payload;
        const passcodeId = `passcode_${channelId || "main"}`;
        const { error } = await supabase.from("config").upsert({ id: passcodeId, text: hashedPasscode, channel_id: channelId || "main", updated_at: new Date().toISOString() });
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "getPasscode": {
        const { channelId } = payload;
        const passcodeId = `passcode_${channelId || "main"}`;
        const { data } = await supabase.from("config").select("text").eq("id", passcodeId).single();
        return res.json({ ok: true, hash: data?.text || null });
      }

      case "verifyAdmin": {
        // just verify the passcode is correct
        return res.json({ ok: true, admin: true });
      }

      case "startLive": {
        const { channelId, title } = payload;
        const liveId = `live_${channelId || "main"}`;
        const sessionId = randomUUID();
        const text = JSON.stringify({ active: true, title: title || "라이브 채팅", sessionId });
        const { error } = await supabase.from("config").upsert({ id: liveId, text, channel_id: channelId || "main", updated_at: new Date().toISOString() });
        if (error) throw error;
        return res.json({ ok: true, sessionId });
      }

      case "endLive": {
        const { channelId } = payload;
        const liveId = `live_${channelId || "main"}`;
        const liveChannelId = `${channelId || "main"}_live`;

        // Stop the live session before cleanup so connected clients leave the
        // live channel while its temporary data is being removed.
        const { error: liveStatusError } = await supabase.from("config").upsert({
          id: liveId,
          text: "false",
          channel_id: channelId || "main",
          updated_at: new Date().toISOString(),
        });
        if (liveStatusError) throw liveStatusError;

        // Collect every media URL before deleting its owning database rows.
        const [messageResult, galleryResult, dmResult] = await Promise.all([
          supabase.from("messages").select("image").eq("channel_id", liveChannelId).not("image", "is", null),
          supabase.from("gallery").select("image").eq("channel_id", liveChannelId).not("image", "is", null),
          supabase.from("dm").select("image").eq("channel_id", liveChannelId).not("image", "is", null),
        ]);
        if (messageResult.error) throw messageResult.error;
        if (galleryResult.error) throw galleryResult.error;
        if (dmResult.error) throw dmResult.error;

        const mediaPaths = [
          ...(messageResult.data || []),
          ...(galleryResult.data || []),
          ...(dmResult.data || []),
        ].map((row) => getMediaStoragePath(row.image));
        await removeMediaFiles(mediaPaths);

        // Replies and reactions live inside message rows, so deleting all live
        // messages removes those records as well.
        await deleteWhere("messages", "channel_id", liveChannelId);
        await deleteWhere("gallery", "channel_id", liveChannelId);
        await deleteWhere("dm", "channel_id", liveChannelId);
        await deleteWhere("blocked", "channel_id", liveChannelId);
        await deleteWhere("config", "channel_id", liveChannelId);
        return res.json({ ok: true });
      }

      case "setBannedWords": {
        const { channelId, words } = payload;
        const wordId = `bannedWords_${channelId || "main"}`;
        const { error } = await supabase.from("config").upsert({ id: wordId, text: words || "", channel_id: channelId || "main", updated_at: new Date().toISOString() });
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "getBannedWords": {
        const { channelId } = payload;
        const wordId = `bannedWords_${channelId || "main"}`;
        const { data } = await supabase.from("config").select("text").eq("id", wordId).single();
        return res.json({ ok: true, words: data?.text || "" });
      }

      case "uploadProfile": {
        const { channelId, imageBase64 } = payload;
        if (!imageBase64) return res.json({ ok: true, url: null });
        // decode base64 to buffer
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const fileName = `profiles/profile_${channelId}_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage.from("media").upload(fileName, buffer, {
          contentType: "image/jpeg",
          upsert: true,
        });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("media").getPublicUrl(fileName);
        // save URL to config
        const profileId = `profile_img_${channelId}`;
        await supabase.from("config").upsert({ id: profileId, text: urlData.publicUrl, channel_id: channelId, updated_at: new Date().toISOString() });
        return res.json({ ok: true, url: urlData.publicUrl });
      }

      case "setChannelName": {
        const { channelId, name } = payload;
        const nameId = `channelName_${channelId}`;
        const { error } = await supabase.from("config").upsert({ id: nameId, text: name || "", channel_id: channelId, updated_at: new Date().toISOString() });
        if (error) throw error;
        return res.json({ ok: true });
      }

      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
