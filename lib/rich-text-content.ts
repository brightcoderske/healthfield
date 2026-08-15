import sanitizeHtml from "sanitize-html";

const SAFE_COLOUR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;
const SAFE_FONT_SIZE = /^(?:12|14|16|18|20|24|28|32)px$/;
const SAFE_ALIGNMENT = /^(?:left|center|right|justify)$/;
const SAFE_FONT_FAMILY = /^(?:Arial|Georgia|Times New Roman|"Times New Roman"|Verdana|Trebuchet MS|"Trebuchet MS"|Courier New|"Courier New")$/i;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(value: string) {
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^tel:/i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return null;
}

function safeColour(value: string) {
  const colour = value.trim();
  return /^#[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(colour) ? colour : null;
}

function decodeCodePoint(value: string, radix: number) {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : " ";
}

function closingBrace(value: string, start: number) {
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "{") depth += 1;
    if (value[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function topLevelDivider(value: string) {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{") depth += 1;
    else if (value[index] === "}") depth -= 1;
    else if (value[index] === "|" && depth === 0) return index;
  }
  return -1;
}

function tokenStart(value: string, index: number) {
  return value.startsWith("**", index) || value.startsWith("++", index) || value.startsWith("==", index) || value[index] === "*" || value[index] === "[" || value[index] === "{";
}

function customTokenNeedsSpace(value: string, index: number) {
  if (index < 1 || /\s/.test(value[index - 1]) || /\s/.test(value[index])) return false;
  if (value[index - 1] !== "}" && value[index] !== "{") return false;
  return !/[.,!?;:)]/.test(value[index]);
}

function legacyInline(value: string): string {
  let html = "";
  let index = 0;

  while (index < value.length) {
    if (html && customTokenNeedsSpace(value, index)) html += " ";

    if (value.startsWith("***", index)) {
      const end = value.indexOf("***", index + 3);
      if (end > index + 3) {
        html += `<strong><em>${legacyInline(value.slice(index + 3, end))}</em></strong>`;
        index = end + 3;
        continue;
      }
    }
    if (value.startsWith("**", index)) {
      const end = value.indexOf("**", index + 2);
      if (end > index + 2) {
        html += `<strong>${legacyInline(value.slice(index + 2, end))}</strong>`;
        index = end + 2;
        continue;
      }
    }
    if (value.startsWith("++", index)) {
      const end = value.indexOf("++", index + 2);
      if (end > index + 2) {
        html += `<u>${legacyInline(value.slice(index + 2, end))}</u>`;
        index = end + 2;
        continue;
      }
    }
    if (value.startsWith("==", index)) {
      const end = value.indexOf("==", index + 2);
      if (end > index + 2) {
        html += `<mark>${legacyInline(value.slice(index + 2, end))}</mark>`;
        index = end + 2;
        continue;
      }
    }
    if (value[index] === "*") {
      const end = value.indexOf("*", index + 1);
      if (end > index + 1) {
        html += `<em>${legacyInline(value.slice(index + 1, end))}</em>`;
        index = end + 1;
        continue;
      }
    }
    if (value[index] === "[") {
      const labelEnd = value.indexOf("](", index + 1);
      if (labelEnd > index) {
        const hrefEnd = value.indexOf(")", labelEnd + 2);
        if (hrefEnd > labelEnd + 2) {
          const label = legacyInline(value.slice(index + 1, labelEnd));
          const href = safeHref(value.slice(labelEnd + 2, hrefEnd));
          html += href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
          index = hrefEnd + 1;
          continue;
        }
      }
    }
    if (value[index] === "{") {
      const end = closingBrace(value, index);
      if (end > index + 2) {
        const token = value.slice(index + 1, end);
        const divider = topLevelDivider(token);
        if (divider > 0) {
          const style = token.slice(0, divider);
          const content = legacyInline(token.slice(divider + 1));
          const colour = safeColour(style.startsWith("color:") ? style.slice(6) : style.startsWith("#") ? style : "");
          const size = style.startsWith("size:") ? style.slice(5) : style;
          if (style === "b") html += `<strong>${content}</strong>`;
          else if (style === "i") html += `<em>${content}</em>`;
          else if (style === "u") html += `<u>${content}</u>`;
          else if (style === "mark") html += `<mark>${content}</mark>`;
          else if (colour) html += `<span style="color: ${colour}">${content}</span>`;
          else if (["sm", "lg", "xl"].includes(size)) {
            const fontSize = size === "sm" ? "12px" : size === "lg" ? "20px" : "24px";
            html += `<span style="font-size: ${fontSize}">${content}</span>`;
          } else html += escapeHtml(value.slice(index, end + 1));
          index = end + 1;
          continue;
        }
      }
    }

    let end = index + 1;
    while (end < value.length && !tokenStart(value, end)) end += 1;
    html += escapeHtml(value.slice(index, end));
    index = end;
  }

  return html;
}

export function legacyRichTextToHtml(value: string) {
  const blocks: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    blocks.push(`<${tag}>${list.items.map((item) => `<li>${legacyInline(item)}</li>`).join("")}</${tag}>`);
    list = null;
  };

  for (const raw of value.split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(`<h${heading[1].length}>${legacyInline(heading[2])}</h${heading[1].length}>`);
    } else if (bullet) {
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]);
    } else {
      flushList();
      if (line.trim()) blocks.push(`<p>${legacyInline(line)}</p>`);
    }
  }
  flushList();
  return blocks.join("");
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][^>]*>/i.test(value);
}

export function richTextToSafeHtml(value: string) {
  const html = looksLikeHtml(value) ? value : legacyRichTextToHtml(value);
  const safe = sanitizeHtml(html, {
    allowedTags: ["p", "h2", "h3", "ul", "ol", "li", "strong", "em", "u", "s", "mark", "a", "span", "blockquote", "br", "hr", "code", "pre"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      span: ["style"],
      mark: ["style"],
      p: ["style"],
      h2: ["style"],
      h3: ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        color: [SAFE_COLOUR],
        "background-color": [SAFE_COLOUR],
        "font-size": [SAFE_FONT_SIZE],
        "font-family": [SAFE_FONT_FAMILY],
        "text-align": [SAFE_ALIGNMENT],
      },
    },
    transformTags: {
      a: (_tagName, attributes) => {
        const href = safeHref(attributes.href || "");
        if (!href) return { tagName: "span", attribs: {} as Record<string, string> };
        const attribs: Record<string, string> = { href };
        if (href.startsWith("http")) {
          attribs.target = "_blank";
          attribs.rel = "noreferrer noopener";
        }
        return {
          tagName: "a",
          attribs,
        };
      },
    },
  }).trim();

  // Some articles created during the transition to the visual editor contain
  // Markdown heading markers inside otherwise valid HTML. Preserve any colour
  // span while normalising those mixed records into real heading elements.
  return safe
    .replace(/<(h[23])([^>]*)>(\s*(?:<span[^>]*>)?)#{2,3}\s+/gi, "<$1$2>$3")
    .replace(/<p([^>]*)>(\s*(?:<span[^>]*>)?)(#{2,3})\s+([\s\S]*?)<\/p>/gi, (_match, attributes: string, prefix: string, marker: string, content: string) => {
      const level = marker.length === 2 ? 2 : 3;
      return `<h${level}${attributes}>${prefix}${content}</h${level}>`;
    });
}

export function richTextToPlainText(value: string) {
  const html = richTextToSafeHtml(value)
    .replace(/<br\s*\/?>|<\/p>|<\/h[23]>|<\/li>|<\/blockquote>/gi, " ")
    .replace(/<\/(?:a|span|strong|em|u|s|mark)>\s*(?=<)/gi, (tag) => `${tag} `);
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&#(\d+);/g, (_match, code: string) => decodeCodePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => decodeCodePoint(code, 16))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function richTextBlocks(value: string) {
  const html = richTextToSafeHtml(value);
  if (!html) return [];
  const blocks: string[] = [];
  const tagPattern = /<\/?([a-z0-9]+)\b[^>]*>/gi;
  const voidTags = new Set(["br", "hr"]);
  let depth = 0;
  let start = 0;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith("</");
    const voidTag = voidTags.has(tag) || match[0].endsWith("/>");
    if (!closing && depth === 0) start = match.index;
    if (!closing && voidTag && depth === 0) {
      blocks.push(html.slice(match.index, tagPattern.lastIndex));
      lastEnd = tagPattern.lastIndex;
    } else if (!closing && !voidTag) depth += 1;
    else if (closing) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        blocks.push(html.slice(start, tagPattern.lastIndex));
        lastEnd = tagPattern.lastIndex;
      }
    }
  }
  const remainder = html.slice(lastEnd).trim();
  if (remainder) blocks.push(`<p>${escapeHtml(remainder)}</p>`);
  return blocks.length ? blocks : [html];
}
