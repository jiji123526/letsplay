export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "url parameter required" });
  }

  try {
    // YouTube: extract video ID and return preview without fetching
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      const videoId = ytMatch[1];
      // use noembed.com to get YouTube title (no CORS/block issues)
      const oembed = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      const oembedData = await oembed.json();
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
      return res.status(200).json({
        title: oembedData.title || "",
        description: oembedData.author_name || "",
        image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        video: "",
        siteName: "YouTube",
        url,
      });
    }

    // For Twitter/X, use fxtwitter for better OG tags
    let fetchUrl = url;
    if (url.match(/https?:\/\/(twitter\.com|x\.com)\//)) {
      fetchUrl = url.replace(/twitter\.com|x\.com/, "fxtwitter.com");
    }

    const response = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html",
      },
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
    let video = getMetaContent("og:video") || getMetaContent("og:video:url") || getMetaContent("twitter:player:stream") || "";
    const siteName = getMetaContent("og:site_name") || "";

    // no video preview for Twitter/X
    if (url.match(/https?:\/\/(twitter\.com|x\.com)\//)) {
      video = "";
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return res.status(200).json({ title, description, image, video, siteName, url });
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch preview" });
  }
}
