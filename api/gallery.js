import { createClient } from "@supabase/supabase-js";
import { isRateLimited } from "../server/rate-limit.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "https://wpwlqpkawssrywlqgncg.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method === "POST") {
    const requestIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
    if (isRateLimited(`gallery:${requestIp}`, 10, 60000)) {
      return res.status(429).json({ error: "rate_limited" });
    }
    const { image, channel_id } = req.body;

    if (!image || !channel_id) {
      return res.status(400).json({ error: "missing fields" });
    }

    const { data, error } = await supabase
      .from("gallery")
      .insert({ image, channel_id })
      .select("id")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, id: data.id });

  } else if (req.method === "DELETE") {
    return res.status(403).json({ error: "admin API required" });

  } else {
    return res.status(405).json({ error: "method not allowed" });
  }
}
