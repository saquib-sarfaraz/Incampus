export const splitTextWithLinks = (input = "") => {
  const text = String(input || "");
  if (!text) return [];
  const regex = /https?:\/\/[^\s]+/gi;
  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, index) });
    }

    let url = match[0] || "";
    let trailing = "";
    while (url && /[).,!?;:]+$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }

    if (url) {
      parts.push({ type: "link", value: url });
    }
    if (trailing) {
      parts.push({ type: "text", value: trailing });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  return parts;
};
