import { Fragment, type ReactNode } from "react";

/**
 * Safe renderer for the lightweight rich-text format stored by the admin editor.
 * Authors edit visually; these tokens are an internal storage detail only.
 */

function safeHref(value: string) {
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^tel:/i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return null;
}

function safeColour(value: string) {
  return /^#[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(value.trim()) ? value.trim() : null;
}

const SIZES: Record<string, string> = { sm: "rt-sm", lg: "rt-lg", xl: "rt-xl" };

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

function inline(value: string, keyPrefix = ""): ReactNode[] {
  const parts: ReactNode[] = [];
  let index = 0;

  while (index < value.length) {
    const key = `${keyPrefix}${index}`;

    if (value.startsWith("**", index)) {
      const end = value.indexOf("**", index + 2);
      if (end > index + 2) {
        parts.push(<strong key={key}>{inline(value.slice(index + 2, end), `${key}-`)}</strong>);
        index = end + 2;
        continue;
      }
    }
    if (value.startsWith("++", index)) {
      const end = value.indexOf("++", index + 2);
      if (end > index + 2) {
        parts.push(<u key={key}>{inline(value.slice(index + 2, end), `${key}-`)}</u>);
        index = end + 2;
        continue;
      }
    }
    if (value.startsWith("==", index)) {
      const end = value.indexOf("==", index + 2);
      if (end > index + 2) {
        parts.push(<mark key={key}>{inline(value.slice(index + 2, end), `${key}-`)}</mark>);
        index = end + 2;
        continue;
      }
    }
    if (value[index] === "*") {
      const end = value.indexOf("*", index + 1);
      if (end > index + 1) {
        parts.push(<em key={key}>{inline(value.slice(index + 1, end), `${key}-`)}</em>);
        index = end + 1;
        continue;
      }
    }
    if (value[index] === "[") {
      const labelEnd = value.indexOf("](", index + 1);
      if (labelEnd > index && value[labelEnd + 2] !== undefined) {
        const hrefEnd = value.indexOf(")", labelEnd + 2);
        if (hrefEnd > labelEnd + 2) {
          const label = value.slice(index + 1, labelEnd);
          const href = safeHref(value.slice(labelEnd + 2, hrefEnd));
          parts.push(href
            ? <a key={key} href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer noopener" } : {})}>{inline(label, `${key}-`)}</a>
            : label);
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
          const content = inline(token.slice(divider + 1), `${key}-`);
          const colour = safeColour(style.startsWith("color:") ? style.slice(6) : style.startsWith("#") ? style : "");
          const size = style.startsWith("size:") ? style.slice(5) : SIZES[style] ? style : "";
          if (style === "b") parts.push(<strong key={key}>{content}</strong>);
          else if (style === "i") parts.push(<em key={key}>{content}</em>);
          else if (style === "u") parts.push(<u key={key}>{content}</u>);
          else if (style === "mark") parts.push(<mark key={key}>{content}</mark>);
          else if (colour) parts.push(<span key={key} style={{ color: colour }}>{content}</span>);
          else if (SIZES[size]) parts.push(<span key={key} className={SIZES[size]}>{content}</span>);
          else parts.push(value.slice(index, end + 1));
          index = end + 1;
          continue;
        }
      }
    }

    let end = index + 1;
    while (end < value.length && !tokenStart(value, end)) end += 1;
    parts.push(value.slice(index, end));
    index = end;
  }

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
