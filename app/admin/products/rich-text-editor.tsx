"use client";

import { Bold, CaseSensitive, Heading2, Highlighter, Italic, Link2, List, ListOrdered, Palette, Underline } from "lucide-react";
import { useRef, useState } from "react";

const swatches = ["#c2185b", "#7c2382", "#15803d", "#1d4ed8", "#b45309", "#2a1730"];
const sizes: Array<[string, string]> = [["sm", "Small"], ["lg", "Large"], ["xl", "Extra large"]];

export function RichTextEditor({
  defaultValue = "", name = "description", rows = 7, maxLength = 1000,
  placeholder = "Detailed product description…", helper = "Maximum 1,000 characters",
}: { defaultValue?: string; name?: string; rows?: number; maxLength?: number; placeholder?: string; helper?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showColours, setShowColours] = useState(false);
  const [showSizes, setShowSizes] = useState(false);

  /** Replaces the selection, keeping the caret sensible afterwards. */
  function apply(build: (selected: string) => string, selectInside = 0) {
    const field = ref.current;
    if (!field) return;
    const start = field.selectionStart, end = field.selectionEnd, value = field.value;
    const selected = value.slice(start, end);
    const inserted = build(selected);
    field.value = value.slice(0, start) + inserted + value.slice(end);
    field.focus();
    const caret = start + (selectInside || inserted.length);
    field.setSelectionRange(caret, selected ? caret + (selectInside ? selected.length : 0) : caret);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const wrap = (mark: string) => apply((selected) => `${mark}${selected || "text"}${mark}`, mark.length);
  const prefixLines = (prefix: (index: number) => string) =>
    apply((selected) => (selected || "List item").split("\n").map((line, index) => `${prefix(index)}${line}`).join("\n"));

  function link() {
    const url = window.prompt("Link address (https://…, mailto:… or /page)");
    if (!url) return;
    apply((selected) => `[${selected || "link text"}](${url.trim()})`);
  }

  function size(token: string) {
    setShowSizes(false);
    apply((selected) => `{${token}|${selected || "text"}}`);
  }

  function colour(hex: string) {
    setShowColours(false);
    apply((selected) => `{${hex}|${selected || "coloured text"}}`);
  }

  return <div className="rich-editor">
    <div className="rich-toolbar">
      <button type="button" onClick={() => wrap("**")} title="Bold"><Bold/></button>
      <button type="button" onClick={() => wrap("*")} title="Italic"><Italic/></button>
      <button type="button" onClick={() => wrap("++")} title="Underline"><Underline/></button>
      <button type="button" onClick={() => wrap("==")} title="Highlight"><Highlighter/></button>
      <button type="button" onClick={() => prefixLines(() => "## ")} title="Heading"><Heading2/></button>
      <button type="button" onClick={() => prefixLines(() => "- ")} title="Bulleted list"><List/></button>
      <button type="button" onClick={() => prefixLines((index) => `${index + 1}. `)} title="Numbered list"><ListOrdered/></button>
      <button type="button" onClick={link} title="Insert link"><Link2/></button>
      <span className="rich-colour">
        <button type="button" onClick={() => setShowSizes((open) => !open)} title="Text size" aria-expanded={showSizes}><CaseSensitive/></button>
        {showSizes && <span className="rich-swatches rich-sizes">
          {sizes.map(([token, label]) => <button key={token} type="button" onClick={() => size(token)}>{label}</button>)}
        </span>}
      </span>
      <span className="rich-colour">
        <button type="button" onClick={() => setShowColours((open) => !open)} title="Text colour" aria-expanded={showColours}><Palette/></button>
        {showColours && <span className="rich-swatches">
          {swatches.map((hex) => (
            <button key={hex} type="button" style={{ background: hex }} title={hex} aria-label={`Colour ${hex}`} onClick={() => colour(hex)}/>
          ))}
        </span>}
      </span>
      <small>{helper}</small>
    </div>
    <textarea ref={ref} name={name} rows={rows} maxLength={maxLength} defaultValue={defaultValue} placeholder={placeholder} required/>
  </div>;
}
