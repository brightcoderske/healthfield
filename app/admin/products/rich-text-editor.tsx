"use client";

import { Bold, CaseSensitive, Heading2, Highlighter, Italic, Link2, List, ListOrdered, Palette, Underline } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ClipboardEvent, type MouseEvent } from "react";
import { RichText } from "@/app/products/rich-text";

const swatches = [
  { value: "#c2185b", label: "Pink" },
  { value: "#7c2382", label: "Purple" },
  { value: "#15803d", label: "Green" },
  { value: "#1d4ed8", label: "Blue" },
  { value: "#b45309", label: "Orange" },
  { value: "#2a1730", label: "Dark" },
] as const;

const sizes = [
  { value: "2", label: "Small" },
  { value: "5", label: "Large" },
  { value: "7", label: "Extra large" },
] as const;

function colourToHex(value: string) {
  const colour = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(colour)) return colour.toLowerCase();
  const match = colour.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replaceAll("\u00a0", " ") ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.tagName === "BR") return "\n";

  const content = Array.from(node.childNodes).map(serializeInline).join("");
  if (!content) return "";
  const tag = node.tagName;
  if (tag === "STRONG" || tag === "B") return `{b|${content}}`;
  if (tag === "EM" || tag === "I") return `{i|${content}}`;
  if (tag === "U") return `{u|${content}}`;
  if (tag === "MARK") return `{mark|${content}}`;
  if (tag === "A") {
    const href = node.getAttribute("href")?.trim() ?? "";
    return href ? `[${content}](${href})` : content;
  }

  const colour = colourToHex(node.style.color || node.getAttribute("color") || "");
  const background = colourToHex(node.style.backgroundColor || "");
  const size = node.classList.contains("rt-sm") || node.getAttribute("size") === "2"
    ? "sm"
    : node.classList.contains("rt-lg") || node.getAttribute("size") === "5"
      ? "lg"
      : node.classList.contains("rt-xl") || node.getAttribute("size") === "7"
        ? "xl"
        : null;

  let formatted = content;
  if (size) formatted = `{size:${size}|${formatted}}`;
  if (background && background !== "#ffffff") formatted = `{mark|${formatted}}`;
  if (colour) formatted = `{color:${colour}|${formatted}}`;
  return formatted;
}

function serializeBlock(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replaceAll("\u00a0", " ") ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName;
  if (tag === "H2" || tag === "H3") return `${tag === "H2" ? "##" : "###"} ${Array.from(node.childNodes).map(serializeInline).join("")}\n`;
  if (tag === "UL" || tag === "OL") return Array.from(node.children).map((item, index) => `${tag === "UL" ? "-" : `${index + 1}.`} ${Array.from(item.childNodes).map(serializeInline).join("")}`).join("\n") + "\n";
  if (tag === "P" || tag === "DIV") return `${Array.from(node.childNodes).map(serializeInline).join("")}\n`;
  return serializeInline(node);
}

function serializeEditor(editor: HTMLElement) {
  return Array.from(editor.childNodes)
    .map(serializeBlock)
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function RichTextEditor({
  defaultValue = "", name = "description", rows = 7, maxLength = 1000,
  placeholder = "Detailed product description…", helper = "Maximum 1,000 characters",
}: { defaultValue?: string; name?: string; rows?: number; maxLength?: number; placeholder?: string; helper?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const [value, setValue] = useState(defaultValue);
  const [showColours, setShowColours] = useState(false);
  const [showSizes, setShowSizes] = useState(false);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const template = templateRef.current?.querySelector<HTMLElement>(".rich-content");
    if (!editor || !template) return;
    editor.innerHTML = template.innerHTML;
    setValue(serializeEditor(editor));
  }, [defaultValue]);

  function syncValue() {
    if (editorRef.current) setValue(serializeEditor(editorRef.current));
  }

  function rememberSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) selectionRef.current = range.cloneRange();
  }

  function restoreSelection() {
    const selection = window.getSelection();
    const range = selectionRef.current;
    if (!selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function keepSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    rememberSelection();
  }

  function command(name: string, commandValue?: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelection();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(name, false, commandValue);
    rememberSelection();
    syncValue();
  }

  function insertLink() {
    restoreSelection();
    const url = window.prompt("Enter a link, for example https://example.com or /contact");
    if (!url) return;
    const href = url.trim();
    if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href) && !/^tel:/i.test(href) && !(href.startsWith("/") && !href.startsWith("//"))) {
      window.alert("Use a complete website link, email link, phone link or a page beginning with /.");
      return;
    }
    command("createLink", href);
  }

  function pastePlainText(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    command("insertText", event.clipboardData.getData("text/plain"));
  }

  const overLimit = value.length > maxLength;

  return <div className={`rich-editor visual-rich-editor${overLimit ? " is-over-limit" : ""}`}>
    <div className="rich-toolbar" role="toolbar" aria-label="Text formatting">
      <button type="button" onMouseDown={keepSelection} onClick={() => command("bold")} title="Bold" aria-label="Bold"><Bold/></button>
      <button type="button" onMouseDown={keepSelection} onClick={() => command("italic")} title="Italic" aria-label="Italic"><Italic/></button>
      <button type="button" onMouseDown={keepSelection} onClick={() => command("underline")} title="Underline" aria-label="Underline"><Underline/></button>
      <button type="button" onMouseDown={keepSelection} onClick={() => command("hiliteColor", "#fff0a6")} title="Highlight" aria-label="Highlight"><Highlighter/></button>
      <button type="button" onMouseDown={keepSelection} onClick={() => command("formatBlock", "h2")} title="Heading" aria-label="Heading"><Heading2/></button>
      <button type="button" onMouseDown={keepSelection} onClick={() => command("insertUnorderedList")} title="Bulleted list" aria-label="Bulleted list"><List/></button>
      <button type="button" onMouseDown={keepSelection} onClick={() => command("insertOrderedList")} title="Numbered list" aria-label="Numbered list"><ListOrdered/></button>
      <button type="button" onMouseDown={keepSelection} onClick={insertLink} title="Insert link" aria-label="Insert link"><Link2/></button>
      <span className="rich-colour">
        <button type="button" onMouseDown={keepSelection} onClick={() => { setShowSizes((open) => !open); setShowColours(false); }} title="Text size" aria-label="Text size" aria-expanded={showSizes}><CaseSensitive/></button>
        {showSizes ? <span className="rich-swatches rich-sizes">
          {sizes.map((size) => <button key={size.value} type="button" onMouseDown={keepSelection} onClick={() => { setShowSizes(false); command("fontSize", size.value); }}>{size.label}</button>)}
        </span> : null}
      </span>
      <span className="rich-colour">
        <button type="button" onMouseDown={keepSelection} onClick={() => { setShowColours((open) => !open); setShowSizes(false); }} title="Text colour" aria-label="Text colour" aria-expanded={showColours}><Palette/></button>
        {showColours ? <span className="rich-swatches">
          {swatches.map((swatch) => <button key={swatch.value} type="button" style={{ background: swatch.value }} title={swatch.label} aria-label={`${swatch.label} text`} onMouseDown={keepSelection} onClick={() => { setShowColours(false); command("foreColor", swatch.value); }}/>) }
        </span> : null}
      </span>
      <small className={overLimit ? "rich-limit-warning" : undefined}>{overLimit ? `Shorten this text by ${value.length - maxLength} characters` : helper}</small>
    </div>
    <div
      ref={editorRef}
      className="rich-editor-surface rich-content"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Formatted text"
      aria-invalid={overLimit}
      data-placeholder={placeholder}
      style={{ minHeight: `${Math.max(5, rows) * 22}px` }}
      spellCheck
      onInput={syncValue}
      onBlur={rememberSelection}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      onPaste={pastePlainText}
    />
    <input type="hidden" name={name} value={value}/>
    <div ref={templateRef} className="rich-editor-template" aria-hidden="true"><RichText value={defaultValue}/></div>
  </div>;
}
