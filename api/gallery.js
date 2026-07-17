import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "https://wpwlqpkawssrywlqgncg.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method === "POST") {
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
    const { id } = req.body;

    if (!id) return res.status(400).json({ error: "missing id" });

    // get image URL to delete from storage
    const { data } = await supabase.from("gallery").select("image").eq("id", id).single();
    if (data && data.image) {
      const path = data.image.split("/media/")[1];
      if (path) await supabase.storage.from("media").remove([path]);
    }

    const { error } = await supabase.from("gallery").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });

  } else {
    return res.status(405).json({ error: "method not allowed" });
  }
}
