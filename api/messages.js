import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "https://wpwlqpkawssrywlqgncg.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

// Rate limit: max 5 messages per 10 seconds per user
const rateLimits = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW = 10000;

function isRateLimited(uid) {
  const now = Date.now();
  const timestamps = rateLimits.get(uid) || [];
  const recent = timestamps.filter(t => now - t < RATE_WINDOW);
  rateLimits.set(uid, recent);
  return recent.length >= RATE_LIMIT;
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { uid, fingerprint, text, image, type, is_admin, admin_passcode, channel_id, nick, reply_to, report, reported_msg_id, image_w, image_h, gallery_id, dm } = req.body;

    if (!uid || !channel_id) {
      return res.status(400).json({ error: "missing fields" });
    }

    // message length limit
    if (text && text.length > 5000) {
      return res.status(400).json({ error: "too_long" });
    }

    // Never trust the client-side is_admin flag by itself. Admin messages must
    // prove admin access on the server before bypassing user restrictions.
    const configuredAdminPasscode = process.env.ADMIN_PASSCODE;
    const verifiedAdmin = is_admin === true
      && typeof configuredAdminPasscode === "string"
      && configuredAdminPasscode.length > 0
      && admin_passcode === configuredAdminPasscode;
    if (is_admin && !verifiedAdmin) {
      return res.status(403).json({ error: "admin_auth_required" });
    }

    // check if user is banned (by uid or fingerprint)
    const { data: bans } = await supabase
      .from("blocked")
      .select("uid")
      .eq("channel_id", channel_id)
      .or(`uid.eq.${uid}${fingerprint ? `,fingerprint.eq.${fingerprint}` : ""}`);

    if (bans && bans.length > 0) {
      return res.status(403).json({ error: "banned" });
    }

    // freeze check: non-admin can't send when frozen
    if (!verifiedAdmin) {
      const frozenId = `notice_frozen_${channel_id}`;
      const { data: frozenData } = await supabase.from("config").select("text").eq("id", frozenId).single();
      if (frozenData && frozenData.text === "true") {
        return res.status(403).json({ error: "frozen" });
      }
    }

    // rate limit
    if (!verifiedAdmin && isRateLimited(uid)) {
      return res.status(429).json({ error: "rate_limited" });
    }

    // banned words check
    if (!verifiedAdmin && text) {
      const wordId = `bannedWords_${channel_id}`;
      const { data: wordData } = await supabase.from("config").select("text").eq("id", wordId).single();
      if (wordData && wordData.text) {
        let bannedWords = [];
        try {
          if (wordData.text.startsWith("[")) {
            // JSON format with expiry
            const parsed = JSON.parse(wordData.text);
            const now = Date.now();
            bannedWords = parsed
              .filter(w => !w.expires || new Date(w.expires).getTime() > now)
              .map(w => w.word);
          } else {
            // legacy comma-separated format
            bannedWords = wordData.text.split(",").map(w => w.trim()).filter(Boolean);
          }
        } catch { bannedWords = []; }
        const found = bannedWords.find(w => text.includes(w));
        if (found) {
          return res.status(403).json({ error: "banned_word", word: found });
        }
      }
    }

    // record timestamp for rate limiting
    const timestamps = rateLimits.get(uid) || [];
    timestamps.push(Date.now());
    rateLimits.set(uid, timestamps);

    // build row
    const row = {
      uid,
      auth_uid: uid,
      nick: nick || null,
      text: text || "",
      is_admin: verifiedAdmin,
      channel_id,
      fingerprint: fingerprint || null,
      image: image || null,
      created_at: new Date().toISOString(),
    };
    if (reply_to) row.reply_to = reply_to;
    if (report) { row.report = true; row.reported_msg_id = reported_msg_id || null; }
    if (image_w) row.image_w = image_w;
    if (image_h) row.image_h = image_h;
    if (gallery_id) row.gallery_id = gallery_id;
    if (dm) row.dm = true;

    const { error } = await supabase.from("messages").insert(row);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });

  } else if (req.method === "DELETE") {
    const { id, uid, channel_id } = req.body;

    if (!id || !uid) {
      return res.status(400).json({ error: "missing fields" });
    }

    // non-admin can only delete own messages
    const { data: msg } = await supabase
      .from("messages")
      .select("uid, gallery_id")
      .eq("id", id)
      .single();

    if (!msg) return res.status(404).json({ error: "not found" });
    if (msg.uid !== uid) return res.status(403).json({ error: "not yours" });

    // delete gallery item if exists
    if (msg.gallery_id) {
      const { data: gallery } = await supabase.from("gallery").select("image").eq("id", msg.gallery_id).single();
      if (gallery && gallery.image) {
        const path = gallery.image.split("/media/")[1];
        if (path) await supabase.storage.from("media").remove([path]);
      }
      await supabase.from("gallery").delete().eq("id", msg.gallery_id);
    }

    const { error } = await supabase.from("messages").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });

  } else if (req.method === "PATCH") {
    const { id, uid, action, text } = req.body;

    if (!id || !uid) {
      return res.status(400).json({ error: "missing fields" });
    }

    // verify ownership for edit/delete (not for reactions)
    if (action === "soft-delete" || action === "edit") {
      const { data: msg } = await supabase
        .from("messages")
        .select("uid")
        .eq("id", id)
        .single();

      if (!msg) return res.status(404).json({ error: "not found" });
      if (msg.uid !== uid) return res.status(403).json({ error: "not yours" });
    }

    if (action === "soft-delete") {
      const { error } = await supabase.from("messages").update({ deleted: true, text: "", image: null, gallery_id: null }).eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
    } else if (action === "edit") {
      const { error } = await supabase.from("messages").update({ text: text || "", edited: true }).eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
    } else if (action === "react") {
      const { emoji } = req.body;
      if (!emoji) return res.status(400).json({ error: "missing emoji" });
      const { data: msgData } = await supabase.from("messages").select("reactions").eq("id", id).single();
      const reactions = msgData?.reactions || {};
      const key = `${uid}_${emoji.codePointAt(0).toString(16)}`;
      if (reactions[key]) {
        delete reactions[key];
      } else {
        reactions[key] = emoji;
      }
      const { error } = await supabase.from("messages").update({ reactions }).eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
    } else if (action === "react-clear") {
      const { data: msgData } = await supabase.from("messages").select("reactions").eq("id", id).single();
      const reactions = msgData?.reactions || {};
      Object.keys(reactions).forEach((key) => {
        if (key.startsWith(`${uid}_`)) delete reactions[key];
      });
      const { error } = await supabase.from("messages").update({ reactions }).eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      return res.status(400).json({ error: "unknown action" });
    }

    return res.json({ ok: true });

  } else {
    return res.status(405).json({ error: "method not allowed" });
  }
}
