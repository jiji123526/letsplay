import { createClient } from "@supabase/supabase-js";
import { requireSupabaseUser } from "../server/auth.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "https://wpwlqpkawssrywlqgncg.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

const PUBLIC_MESSAGE_COLUMNS = "id,uid,nick,text,is_admin,reply_to,report,reported_msg_id,gallery_id,dm,deleted,edited,reported,reactions,image,image_w,image_h,channel_id,created_at";
const ADMIN_MESSAGE_COLUMNS = `${PUBLIC_MESSAGE_COLUMNS},fingerprint`;

function isAdminRequest(req) {
  const configured = process.env.ADMIN_PASSCODE;
  return typeof configured === "string"
    && configured.length > 0
    && req.headers["x-admin-passcode"] === configured;
}

function parseLiveStatus(text) {
  if (!text) return { active: false, title: "", sessionId: "" };
  try {
    const value = JSON.parse(text);
    if (typeof value === "object" && value !== null) {
      return {
        active: value.active === true,
        title: String(value.title || ""),
        sessionId: String(value.sessionId || ""),
      };
    }
  } catch { /* legacy true/false value */ }
  return { active: text === "true", title: "", sessionId: "" };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const resource = String(req.query.resource || "");
  const channelId = String(req.query.channel_id || "main");
  const admin = isAdminRequest(req);
  let adminUser = null;
  if (admin) {
    adminUser = await requireSupabaseUser(req, res, supabase);
    if (!adminUser) return;
  }

  try {
    if (resource === "messages") {
      const limit = Math.min(Math.max(Number(req.query.limit) || 2000, 1), 2000);
      let query = supabase
        .from("messages")
        .select(admin ? ADMIN_MESSAGE_COLUMNS : PUBLIC_MESSAGE_COLUMNS)
        .eq("channel_id", channelId);
      if (!admin) query = query.eq("report", false);
      if (req.query.id) query = query.eq("id", String(req.query.id));
      if (req.query.gallery_id) query = query.eq("gallery_id", String(req.query.gallery_id));
      if (req.query.before) query = query.lt("created_at", String(req.query.before));
      const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return res.json({ items: (data || []).reverse() });
    }

    if (resource === "search") {
      const search = String(req.query.q || "").slice(0, 200);
      if (!search) return res.json({ items: [] });
      let query = supabase
        .from("messages")
        .select(admin ? ADMIN_MESSAGE_COLUMNS : PUBLIC_MESSAGE_COLUMNS)
        .eq("channel_id", channelId)
        .textSearch("text", search, { type: "websearch" });
      if (!admin) query = query.eq("report", false);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return res.json({ items: data || [] });
    }

    if (resource === "live_status") {
      const { data, error } = await supabase
        .from("config")
        .select("text")
        .eq("id", `live_${channelId}`)
        .maybeSingle();
      if (error) throw error;
      return res.json({ items: [parseLiveStatus(data?.text)] });
    }

    if (resource === "gallery") {
      const { data, error } = await supabase
        .from("gallery")
        .select("id,image,channel_id,created_at")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.json({ items: data || [] });
    }

    if (resource === "dm") {
      if (!admin) return res.status(403).json({ error: "admin required" });
      const { data, error } = await supabase
        .from("dm")
        .select("id,uid,nick,text,image,channel_id,created_at")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return res.json({ items: data || [] });
    }

    if (resource === "blocked") {
      if (admin) {
        const { data, error } = await supabase
          .from("blocked")
          .select("uid,fingerprint,reason")
          .eq("channel_id", channelId);
        if (error) throw error;
        return res.json({ items: data || [] });
      }
      const rawFingerprint = String(req.query.fingerprint || "").slice(0, 256);
      const fingerprint = /^fp_[a-z0-9]+$/.test(rawFingerprint) ? rawFingerprint : "";
      const rawUid = String(req.query.uid || "").slice(0, 64);
      const uid = /^[a-f0-9-]{36}$/i.test(rawUid) ? rawUid : "";
      if (!uid) return res.status(400).json({ error: "invalid uid" });
      let query = supabase.from("blocked").select("uid,fingerprint,reason").eq("channel_id", channelId);
      query = fingerprint
        ? query.or(`uid.eq.${uid},fingerprint.eq.${fingerprint}`)
        : query.eq("uid", uid);
      const { data, error } = await query.limit(1);
      if (error) throw error;
      // Ordinary clients only need the result of the block check. Do not
      // disclose the stored UID, fingerprint, or moderation reason.
      return res.json({ items: data?.length ? [{ uid }] : [] });
    }

    return res.status(400).json({ error: "unknown resource" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
