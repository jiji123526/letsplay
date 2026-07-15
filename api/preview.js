export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "url parameter required" });
  }

  try {
    // For Twitter/X, use fxtwitter for better OG tags
    let fetchUrl = url;
    if (url.match(/https?:\/\/(twitter\.com|x\.com)\//)) {
      fetchUrl = url.replace(/twitter\.com|x\.com/, "fxtwitter.com");
    }

    const response = await fetch(fetchUrl, {
      headers: { "User-Agent": "bot" },
      redirect: "follow",
    });

    const html = await response.text();

    // Extract OG meta tags
    const getMetaContent = (property) => {
      const match = html.match(new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"))
        || html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, "i"))
        || html.match(new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"));
      return match ? match[1] : "";
    };

    const title = getMetaContent("og:title") || getMetaContent("twitter:title") || "";
    const description = getMetaContent("og:description") || getMetaContent("twitter:description") || "";
    const image = getMetaContent("og:image") || getMetaContent("twitter:image") || "";
    const siteName = getMetaContent("og:site_name") || "";

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return res.status(200).json({ title, description, image, siteName, url });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch preview" });
  }
}
