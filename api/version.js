export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.status(200).json({
    version: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  });
}
