import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "https://wpwlqpkawssrywlqgncg.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { uid, nick, text, image, channel_id } = req.body;

  if (!uid || !channel_id) {
    return res.status(400).json({ error: "missing fields" });
  }

  const row = {
    uid,
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
