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
    const { uid, fingerprint, text, image, type, is_admin, channel_id, nick, reply_to, report, reported_msg_id, image_w, image_h, gallery_id, dm } = req.body;

    if (!uid || !channel_id) {
      return res.status(400).json({ error: "missing fields" });
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

    // rate limit
    if (!is_admin && isRateLimited(uid)) {
      return res.status(429).json({ error: "rate_limited" });
    }

    // banned words check (fetch from settings)
    // TODO: could fetch banned_words from config table if needed

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
      is_admin: !!is_admin,
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
      .select("uid")
      .eq("id", id)
      .single();

    if (!msg) return res.status(404).json({ error: "not found" });
    if (msg.uid !== uid) return res.status(403).json({ error: "not yours" });

    const { error } = await supabase.from("messages").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });

  } else {
    return res.status(405).json({ error: "method not allowed" });
  }
}
