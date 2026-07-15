import { createClient } from "@supabase/supabase-js";

// Uses service role key — full access, bypasses RLS
const supabase = createClient(
  process.env.SUPABASE_URL || "https://wpwlqpkawssrywlqgncg.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { passcode, action, payload } = req.body;

  // verify admin passcode
  if (passcode !== process.env.ADMIN_PASSCODE) {
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
        const { text } = payload;
        const { error } = await supabase.from("config").upsert({ id: "notice", text, updated_at: new Date().toISOString() });
        if (error) throw error;
        return res.json({ ok: true });
      }

      case "verifyAdmin": {
        // just verify the passcode is correct
        return res.json({ ok: true, admin: true });
      }

      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
