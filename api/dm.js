import { createClient } from "@supabase/supabase-js";
import { isRateLimited } from "../server/rate-limit.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "https://wpwlqpkawssrywlqgncg.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { uid, nick, text, image, channel_id } = req.body;
  if (!uid || !/^[a-f0-9-]{36}$/i.test(uid)) {
    return res.status(400).json({ error: "invalid uid" });
  }
  const requestIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(`dm:${requestIp}`, 5, 10000)) {
    return res.status(429).json({ error: "rate_limited" });
  }

  if (!channel_id) {
    return res.status(400).json({ error: "missing fields" });
  }

  const row = {
    // This UID is a local browser identifier, not an authenticated identity.
    uid,
    auth_uid: null,
    nick: nick || null,
    text: text || "",
    image: image || null,
    channel_id,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("dm").insert(row);
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true });
}
