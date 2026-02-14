const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toText = (value, fallback = "") => {
  if (!value) return fallback;
  return String(value).trim();
};

const buildOrigin = (req) => {
  const proto =
    req.headers["x-forwarded-proto"] ||
    (req.headers["x-forwarded-protocol"] || "https");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
};

const toAbsoluteUrl = (origin, url) => {
  const value = toText(url);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${origin}${value}`;
  return `${origin}/${value}`;
};

const safeDecode = (value = "") => {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
};

const resolveShareData = (req) => {
  const query = req.query || {};
  const id =
    query.id ||
    query.postId ||
    query.post ||
    query.post_id ||
    query.p ||
    "";
  const title =
    safeDecode(query.title || query.t || query.name || "") || "InCampus Post";
  const description = safeDecode(query.text || query.desc || query.d || "");
  const image = safeDecode(query.image || query.img || query.i || "");
  return { id: String(id || ""), title, description, image };
};

export default async function handler(req, res) {
  const origin = buildOrigin(req);
  const { id, title, description, image } = resolveShareData(req);
  const safeTitle = escapeHtml(title || "InCampus Post");
  const safeDescription = escapeHtml(description || "Check out this post on InCampus.");
  const safeImage =
    escapeHtml(toAbsoluteUrl(origin, image)) || `${origin}/incampus-icon.svg`;
  const redirectUrl = id
    ? `${origin}/feed?post=${encodeURIComponent(id)}`
    : `${origin}/feed`;
  const canonicalUrl = id ? `${origin}/share/${encodeURIComponent(id)}` : `${origin}/share`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:image" content="${safeImage}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeImage}" />
    <meta http-equiv="refresh" content="0; url=${redirectUrl}" />
    <style>
      body { font-family: Arial, sans-serif; background: #0f0c0a; color: #faf0e6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      a { color: #f0b27a; text-decoration: none; }
      .wrap { text-align: center; padding: 24px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <p>Opening post…</p>
      <p><a href="${redirectUrl}">Tap to continue</a></p>
    </div>
    <script>
      window.location.replace(${JSON.stringify(redirectUrl)});
    </script>
  </body>
</html>`);
}
