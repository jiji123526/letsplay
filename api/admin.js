import { createClient } from "@supabase/supabase-js";

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
        const { channelId } = payload;
        const liveId = `live_${channelId || "main"}`;
        const { error } = await supabase.from("config").upsert({ id: liveId, text: "true", channel_id: channelId || "main", updated_at: new Date().toISOString() });
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "endLive": {
        const { channelId } = payload;
        const liveId = `live_${channelId || "main"}`;
        // set live to false
        await supabase.from("config").upsert({ id: liveId, text: "false", channel_id: channelId || "main", updated_at: new Date().toISOString() });
        // delete all live messages
        const liveChannelId = `${channelId || "main"}_live`;
        await supabase.from("messages").delete().eq("channel_id", liveChannelId);
        await supabase.from("gallery").delete().eq("channel_id", liveChannelId);
        await supabase.from("dm").delete().eq("channel_id", liveChannelId);
        await supabase.from("config").delete().eq("id", `notice_${liveChannelId}`);
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

      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
