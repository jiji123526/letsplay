export function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function requireSupabaseUser(req, res, supabase) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "authentication required" });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: "invalid session" });
    return null;
  }
  return data.user;
}
