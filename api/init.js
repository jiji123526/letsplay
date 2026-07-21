import { createClient } from "@supabase/supabase-js";

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
      return { active: value.active === true, title: String(value.title || ""), sessionId: String(value.sessionId || "") };
    }
  } catch {}
  return { active: text === "true", title: "", sessionId: "" };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const channelId = String(req.query.channel_id || "main");
  const admin = isAdminRequest(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);

  try {
    // fetch all initial data in parallel
    const [messagesResult, galleryResult, blockedResult, configResults] = await Promise.all([
      // messages
      supabase
        .from("messages")
        .select(admin ? ADMIN_MESSAGE_COLUMNS : PUBLIC_MESSAGE_COLUMNS)
        .eq("channel_id", channelId)
        .eq("report", false)
        .order("created_at", { ascending: false })
        .limit(limit),
      // gallery
      supabase
        .from("gallery")
        .select("id,image,channel_id,created_at")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false })
        .limit(100),
      // blocked (admin only - non-admin fetches via /api/data with uid/fingerprint filter)
      admin
        ? supabase.from("blocked").select("uid,fingerprint,reason").eq("channel_id", channelId)
        : Promise.resolve({ data: null, error: null }),
      // config: freeze, profile name, profile image, notice, live status
      supabase
        .from("config")
        .select("id,text")
        .in("id", [
          `notice_frozen_${channelId}`,
          `channelName_${channelId}`,
          `profile_img_${channelId}`,
          `notice_${channelId}`,
          `live_${channelId}`,
        ]),
    ]);

    if (messagesResult.error) throw messagesResult.error;
    if (galleryResult.error) throw galleryResult.error;
    if (blockedResult.error) throw blockedResult.error;
    if (configResults.error) throw configResults.error;

    // parse config into structured object
    const configMap = {};
    (configResults.data || []).forEach(row => { configMap[row.id] = row.text; });

    const response = {
      messages: (messagesResult.data || []).reverse(),
      gallery: galleryResult.data || [],
      blocked: admin ? (blockedResult.data || []) : null,
      config: {
        frozen: configMap[`notice_frozen_${channelId}`] === "true",
        channelName: configMap[`channelName_${channelId}`] || null,
        profileImage: configMap[`profile_img_${channelId}`] || null,
        notice: configMap[`notice_${channelId}`] || "",
        liveStatus: parseLiveStatus(configMap[`live_${channelId}`]),
      },
    };

    // DM for admin only
    if (admin) {
      const dmResult = await supabase
        .from("dm")
        .select("id,uid,nick,text,image,channel_id,created_at")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: true })
        .limit(500);
      response.dm = dmResult.data || [];
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json(response);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
