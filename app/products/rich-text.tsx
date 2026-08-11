import { Fragment, ReactNode } from "react";

/**
 * Renderer for the lightweight article/description markup.
 *
 * Content is stored as plain text, never HTML, so nothing an author types can
 * inject markup. Everything below is opt-in and validated:
 *
 *   **bold**   *italic*   ++underline++   ==highlight==
 *   [label](https://example.com)          {#c2185b|coloured text}
 *   {lg|larger text}   {sm|smaller text}   {xl|headline-sized text}
 *   ## Heading
 *   - bullet item
 *   1. numbered item
 */

// Only navigable, non-scripting destinations. Anything else renders as plain text,
// which keeps `javascript:` and `data:` URLs out of the page entirely.
function safeHref(value: string) {
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^tel:/i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return null;
}

// A colour must be a plain hex value; no arbitrary CSS may reach the style attribute.
function safeColour(value: string) {
  return /^#[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(value.trim()) ? value.trim() : null;
}

// Sizes are a fixed set of class names, never free-form CSS.
const SIZES: Record<string, string> = { sm: "rt-sm", lg: "rt-lg", xl: "rt-xl" };
const INLINE = /(\*\*[^*]+\*\*|\+\+[^+]+\+\+|==[^=]+==|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\)|\{#[0-9a-fA-F]{3,8}\|[^}]+\}|\{(?:sm|lg|xl)\|[^}]+\})/g;

function inline(value: string, keyPrefix = ""): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of value.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(value.slice(last, index));
    const token = match[0];
    const key = `${keyPrefix}${index}`;
    if (token.startsWith("**")) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("++")) parts.push(<u key={key}>{token.slice(2, -2)}</u>);
    else if (token.startsWith("==")) parts.push(<mark key={key}>{token.slice(2, -2)}</mark>);
    else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]"));
      const href = safeHref(token.slice(token.indexOf("(") + 1, -1));
      parts.push(href
        ? <a key={key} href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer noopener" } : {})}>{label}</a>
        : label);
    } else if (/^\{(sm|lg|xl)\|/.test(token)) {
      const divider = token.indexOf("|");
      parts.push(<span key={key} className={SIZES[token.slice(1, divider)]}>{token.slice(divider + 1, -1)}</span>);
    } else if (token.startsWith("{#")) {
      const divider = token.indexOf("|");
      const colour = safeColour(token.slice(1, divider));
      const text = token.slice(divider + 1, -1);
      parts.push(colour ? <span key={key} style={{ color: colour }}>{text}</span> : text);
    } else parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = index + token.length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return parts;
}

export function RichText({ value }: { value: string }) {
  const lines = value.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item, `${blocks.length}-${index}-`)}</li>);
    blocks.push(list.ordered ? <ol key={`l${blocks.length}`}>{items}</ol> : <ul key={`l${blocks.length}`}>{items}</ul>);
    list = null;
  };

  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+\.\s+(.+)$/);

    if (heading) {
      flush();
      const text = heading[2];
      blocks.push(heading[1].length === 2
        ? <h2 key={index}>{inline(text, `${index}-`)}</h2>
        : <h3 key={index}>{inline(text, `${index}-`)}</h3>);
      return;
    }
    if (bullet) { if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; } list.items.push(bullet[1]); return; }
    if (numbered) { if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; } list.items.push(numbered[1]); return; }
    flush();
    if (!line.trim()) return;
    blocks.push(<p key={index}>{inline(line, `${index}-`)}</p>);
  });
  flush();

  return <div className="rich-content">{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>;
}
