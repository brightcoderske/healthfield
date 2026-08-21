"use client";

import CharacterCount from "@tiptap/extension-character-count";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { richTextToPlainText, richTextToSafeHtml } from "@/lib/rich-text-content";

const TEXT_COLOURS = ["#2a1730", "#7c2382", "#c2185b", "#15803d", "#1d4ed8", "#b45309"];
const HIGHLIGHT_COLOURS = ["#fff0a6", "#ffd8e8", "#e2d4f0", "#d5f5df", "#dbeafe"];
const FONT_SIZES = [
  { label: "2", value: "12px", title: "Small" },
  { label: "3", value: "16px", title: "Normal" },
  { label: "5", value: "24px", title: "Large" },
  { label: "7", value: "32px", title: "Display" },
] as const;
const FONT_FAMILIES = ["Arial", "Georgia", "Times New Roman", "Verdana", "Trebuchet MS", "Courier New"] as const;

type TiptapEditor = NonNullable<ReturnType<typeof useEditor>>;
type ChainedCommands = ReturnType<TiptapEditor["chain"]>;

function validLink(value: string) {
  const href = value.trim();
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href) || /^tel:/i.test(href)) return href;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return null;
}

type EditorButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function EditorButton({ label, active, disabled = false, onClick, children }: EditorButtonProps) {
  return <button
    type="button"
    className={active ? "is-active" : undefined}
    aria-label={label}
    title={label}
    aria-pressed={active === undefined ? undefined : active}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
  >{children}</button>;
}

/**
 * The quick-edit bar that appears over a selection.
 *
 * The ribbon at the top of the editor is a long way from the words being changed,
 * especially on a phone where it is pinned above a scrolling body. This puts the four
 * things people reach for most — bold, italic, underline, colour — next to the
 * selection itself, on every screen size.
 *
 * Deliberately small: a bubble that grows into a second ribbon covers the text it is
 * meant to help you edit.
 */
function RichTextBubble({ editor }: { editor: TiptapEditor | null }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      return {
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        underline: current.isActive("underline"),
        colour: String(current.getAttributes("textStyle").color || "").toLowerCase(),
      };
    },
  });
  if (!editor) return null;
  return (
    <BubbleMenu
      editor={editor}
      // An empty selection means a caret, not a selection: showing the bar then would
      // make it flicker on every click into the text.
      shouldShow={({ editor: current, from, to }) => from !== to && current.isEditable}
      options={{ placement: "top", offset: 8 }}
    >
      <div className="rich-bubble" role="toolbar" aria-label="Quick formatting">
        <button type="button" className={state?.bold ? "is-active" : ""} aria-pressed={Boolean(state?.bold)} title="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></button>
        <button type="button" className={state?.italic ? "is-active" : ""} aria-pressed={Boolean(state?.italic)} title="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></button>
        <button type="button" className={state?.underline ? "is-active" : ""} aria-pressed={Boolean(state?.underline)} title="Underline"
          onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline /></button>
        <span className="rich-bubble-divider" aria-hidden="true" />
        {TEXT_COLOURS.map((colour) => (
          <button
            key={colour}
            type="button"
            className={`rich-bubble-swatch ${state?.colour === colour ? "is-active" : ""}`}
            style={{ "--swatch": colour } as React.CSSProperties}
            title={`Colour ${colour}`}
            aria-label={`Text colour ${colour}`}
            onClick={() => editor.chain().focus().setColor(colour).run()}
          />
        ))}
        <button type="button" className="rich-bubble-clear" title="Clear colour" aria-label="Clear colour"
          onClick={() => editor.chain().focus().unsetColor().run()}>A</button>
      </div>
    </BubbleMenu>
  );
}

function RichTextToolbar({ editor }: { editor: TiptapEditor | null }) {
  const [palette, setPalette] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const textStyle = current.getAttributes("textStyle");
      return {
        block: current.isActive("heading", { level: 2 }) ? "h2" : current.isActive("heading", { level: 3 }) ? "h3" : "p",
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        underline: current.isActive("underline"),
        strike: current.isActive("strike"),
        bulletList: current.isActive("bulletList"),
        orderedList: current.isActive("orderedList"),
        link: current.isActive("link"),
        alignment: current.isActive({ textAlign: "center" }) ? "center" : current.isActive({ textAlign: "right" }) ? "right" : current.isActive({ textAlign: "justify" }) ? "justify" : "left",
        colour: String(textStyle.color || "").toLowerCase(),
        fontSize: String(textStyle.fontSize || ""),
        fontFamily: String(textStyle.fontFamily || "").replaceAll('"', ""),
        highlight: String(current.getAttributes("highlight").color || "").toLowerCase(),
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
      };
    },
  });

  /**
   * Applies a size or font from the ribbon.
   *
   * Picking one of these moves the focus into the dropdown, so people choose the style
   * first and then click back into the words to type. With nothing selected the style
   * would only be a pending mark, and that click — any click — throws a pending mark
   * away: the text came out at the old size and the dropdown snapped back to its label.
   * With no selection the paragraph the caret sits in is styled instead, which is what
   * "make this bigger" means when nothing is highlighted. The caret is put back where it
   * was, so typing carries on in place and inherits the style.
   */
  const applyTextStyle = (apply: (chain: ChainedCommands) => ChainedCommands) => {
    if (!editor) return;
    const { empty, $from, from } = editor.state.selection;
    const blockStart = $from.start();
    const blockEnd = $from.end();
    if (empty && blockEnd > blockStart) {
      apply(editor.chain().focus().setTextSelection({ from: blockStart, to: blockEnd })).setTextSelection(from).run();
      return;
    }
    apply(editor.chain().focus()).run();
  };

  const editLink = () => {
    if (!editor) return;
    const previous = String(editor.getAttributes("link").href || "");
    const entered = window.prompt("Enter a website, email, phone or site-page link", previous || "https://");
    if (entered === null) return;
    if (!entered.trim()) return void editor.chain().focus().extendMarkRange("link").unsetLink().run();
    const href = validLink(entered);
    if (!href) {
      window.alert("Use https://, http://, mailto:, tel:, or a site page beginning with /.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  return <div className="rich-toolbar" role="toolbar" aria-label="Text formatting">
    <select
      className="rich-block-select"
      aria-label="Text style"
      value={state?.block || "p"}
      disabled={!editor}
      // Acted on as the value changes rather than when the browser settles it. These
      // dropdowns show what the text already is, so a re-render between the two events —
      // and the form re-renders on every input — puts the old value back before `change`
      // arrives, and the pick is read as "no change". `input` runs first, on the value
      // the person actually chose.
      onInput={(event) => {
        const block = event.currentTarget.value;
        if (block === "h2") editor?.chain().focus().setHeading({ level: 2 }).run();
        else if (block === "h3") editor?.chain().focus().setHeading({ level: 3 }).run();
        else editor?.chain().focus().setParagraph().run();
      }}
    >
      <option value="p">Paragraph</option>
      <option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option>
    </select>

    <span className="rich-toolbar-group">
      <EditorButton label="Bold" active={state?.bold} disabled={!editor} onClick={() => void editor?.chain().focus().toggleBold().run()}><Bold/></EditorButton>
      <EditorButton label="Italic" active={state?.italic} disabled={!editor} onClick={() => void editor?.chain().focus().toggleItalic().run()}><Italic/></EditorButton>
      <EditorButton label="Underline" active={state?.underline} disabled={!editor} onClick={() => void editor?.chain().focus().toggleUnderline().run()}><Underline/></EditorButton>
      <EditorButton label="Strikethrough" active={state?.strike} disabled={!editor} onClick={() => void editor?.chain().focus().toggleStrike().run()}><Strikethrough/></EditorButton>
    </span>

    {/* Colours live behind one key rather than eleven. Two palettes spread across the
        ribbon pushed everything else onto extra rows, which on a phone cost more of the
        editor than the colours were worth. The key shows the colour it would apply. */}
    <span className="rich-toolbar-group rich-colour-control">
      <button
        type="button"
        className={`rich-colour-toggle${palette ? " is-active" : ""}`}
        aria-label="Text and highlight colours"
        title="Text and highlight colours"
        aria-expanded={palette}
        disabled={!editor}
        style={{ "--current-text-colour": state?.colour || "#2a1730", "--current-highlight": state?.highlight || "transparent" } as React.CSSProperties}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setPalette((open) => !open)}
      >A</button>
    </span>

    <select
      className="rich-size-select"
      aria-label="Font size"
      title="Font size"
      value={state?.fontSize || ""}
      disabled={!editor}
      onInput={(event) => {
        const size = event.currentTarget.value;
        applyTextStyle((chain) => (size ? chain.setFontSize(size) : chain.unsetFontSize()));
      }}
    >
      <option value="">Size</option>
      {FONT_SIZES.map((size) => <option key={size.value} value={size.value}>{size.label} — {size.title}</option>)}
    </select>

    <select
      className="rich-font-select"
      aria-label="Font style"
      title="Font style"
      value={state?.fontFamily || ""}
      disabled={!editor}
      onInput={(event) => {
        const family = event.currentTarget.value;
        applyTextStyle((chain) => (family ? chain.setFontFamily(family) : chain.unsetFontFamily()));
      }}
    >
      <option value="">Site font</option>
      {FONT_FAMILIES.map((family) => <option key={family} value={family} style={{ fontFamily: family }}>{family}</option>)}
    </select>

    <span className="rich-toolbar-group">
      <EditorButton label="Bulleted list" active={state?.bulletList} disabled={!editor} onClick={() => void editor?.chain().focus().toggleBulletList().run()}><List/></EditorButton>
      <EditorButton label="Numbered list" active={state?.orderedList} disabled={!editor} onClick={() => void editor?.chain().focus().toggleOrderedList().run()}><ListOrdered/></EditorButton>
      <EditorButton label="Add or edit link" active={state?.link} disabled={!editor} onClick={editLink}><Link2/></EditorButton>
      <EditorButton label="Remove link" disabled={!editor || !state?.link} onClick={() => void editor?.chain().focus().extendMarkRange("link").unsetLink().run()}><Unlink/></EditorButton>
    </span>

    <span className="rich-toolbar-group">
      <EditorButton label="Align left" active={state?.alignment === "left"} disabled={!editor} onClick={() => void editor?.chain().focus().setTextAlign("left").run()}><AlignLeft/></EditorButton>
      <EditorButton label="Align centre" active={state?.alignment === "center"} disabled={!editor} onClick={() => void editor?.chain().focus().setTextAlign("center").run()}><AlignCenter/></EditorButton>
      <EditorButton label="Align right" active={state?.alignment === "right"} disabled={!editor} onClick={() => void editor?.chain().focus().setTextAlign("right").run()}><AlignRight/></EditorButton>
      <EditorButton label="Justify" active={state?.alignment === "justify"} disabled={!editor} onClick={() => void editor?.chain().focus().setTextAlign("justify").run()}><AlignJustify/></EditorButton>
    </span>

    <span className="rich-toolbar-group">
      <EditorButton label="Clear formatting" disabled={!editor} onClick={() => void editor?.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting/></EditorButton>
      <EditorButton label="Undo" disabled={!editor || !state?.canUndo} onClick={() => void editor?.chain().focus().undo().run()}><Undo2/></EditorButton>
      <EditorButton label="Redo" disabled={!editor || !state?.canRedo} onClick={() => void editor?.chain().focus().redo().run()}><Redo2/></EditorButton>
    </span>

    {palette ? <div className="rich-colour-panel">
      <div className="rich-colour-row" aria-label="Text colours">
        <span className="rich-colour-row-label">Text</span>
        {TEXT_COLOURS.map((colour) => <button
          key={colour}
          type="button"
          className={`rich-colour-swatch${state?.colour === colour ? " is-active" : ""}`}
          style={{ "--swatch": colour } as React.CSSProperties}
          aria-label={`Text colour ${colour}`}
          title={`Text colour ${colour}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void editor?.chain().focus().setColor(colour).run()}
        />)}
        <label className="rich-custom-colour" title="Choose any text colour" style={{ "--current-text-colour": state?.colour || "#2a1730" } as React.CSSProperties}>
          <span>A</span>
          <input
            type="color"
            aria-label="Choose any text colour"
            value={/^#[0-9a-f]{6}$/i.test(state?.colour || "") ? state!.colour : "#2a1730"}
            onChange={(event) => void editor?.chain().focus().setColor(event.target.value).run()}
          />
        </label>
        <EditorButton label="Remove text colour" disabled={!state?.colour} onClick={() => void editor?.chain().focus().unsetColor().run()}><RemoveFormatting/></EditorButton>
      </div>
      <div className="rich-colour-row" aria-label="Highlight colours">
        <span className="rich-colour-row-label"><Highlighter aria-hidden="true" className="rich-toolbar-label-icon"/></span>
        {HIGHLIGHT_COLOURS.map((colour) => <button
          key={colour}
          type="button"
          className={`rich-highlight-swatch${state?.highlight === colour ? " is-active" : ""}`}
          style={{ "--swatch": colour } as React.CSSProperties}
          aria-label={`Highlight ${colour}`}
          title={`Highlight ${colour}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void editor?.chain().focus().toggleHighlight({ color: colour }).run()}
        />)}
        <EditorButton label="Remove highlight" disabled={!state?.highlight} onClick={() => void editor?.chain().focus().unsetHighlight().run()}><RemoveFormatting/></EditorButton>
      </div>
    </div> : null}
  </div>;
}

function RichTextStatus({ editor, helper, maxLength, initialCharacters }: { editor: TiptapEditor | null; helper: string; maxLength: number; initialCharacters: number }) {
  const status = useEditorState({
    editor,
    selector: ({ editor: current }) => current
      ? { ready: true, characters: current.state.doc.textContent.length }
      : { ready: false, characters: 0 },
  });
  const characters = status?.ready ? status.characters : initialCharacters;
  return <div className="rich-editor-status" aria-live="polite">
    <small>{helper}</small>
    <span className={characters >= maxLength ? "rich-limit-warning" : undefined}>{characters.toLocaleString()} / {maxLength.toLocaleString()}</span>
  </div>;
}

export function RichTextEditor({
  defaultValue = "",
  name = "description",
  rows = 7,
  maxLength = 1000,
  placeholder = "Write a detailed description…",
  helper = "Maximum 1,000 characters",
  restoreRef,
}: {
  defaultValue?: string;
  name?: string;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  helper?: string;
  /** Filled with a function that puts saved HTML back into the editor, for draft recovery. */
  restoreRef?: { current: ((html: string) => void) | null };
}) {
  const initialHtml = useMemo(() => richTextToSafeHtml(defaultValue), [defaultValue]);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  // The field carries its value in state, not only in the DOM. A hidden input has no
  // dirty-value flag — `value` and `defaultValue` are one and the same attribute — so
  // every re-render of the surrounding form re-applied the original HTML and discarded
  // the formatting that had just been chosen. Typing in any other field of the product
  // form was enough to do it.
  const [html, setHtml] = useState(initialHtml);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    content: initialHtml,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          autolink: true,
          defaultProtocol: "https",
          openOnClick: false,
          HTMLAttributes: { rel: "noreferrer noopener", target: "_blank" },
        },
      }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
      Placeholder.configure({ placeholder }),
      CharacterCount.configure({ limit: maxLength }),
    ],
    editorProps: {
      attributes: {
        class: "rich-editor-surface rich-content",
        role: "textbox",
        "aria-label": "Formatted text",
        "aria-multiline": "true",
        spellcheck: "true",
      },
      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.detail > 1) {
            return false;
          }
          const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!point) return false;
          const transaction = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(point.pos)));
          // Moving the caret must not discard a colour or size chosen a moment ago and
          // not yet typed into: clicking where the words should go is part of applying
          // it, not a reason to forget it.
          if (view.state.storedMarks) transaction.setStoredMarks(view.state.storedMarks);
          view.dispatch(transaction);
          view.focus();
          return false;
        },
      },
      handleKeyDown(view, event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
          event.preventDefault();
          view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = current.getHTML();
      const value = next === "<p></p>" ? "" : next;
      // Written straight to the node as well, so anything reading the form during this
      // same keystroke — the on-device draft, for one — sees the current text.
      if (hiddenInputRef.current) hiddenInputRef.current.value = value;
      setHtml(value);
    },
  });

  useEffect(() => {
    if (!restoreRef) return;
    restoreRef.current = editor
      ? (value: string) => {
          const safe = richTextToSafeHtml(value);
          editor.commands.setContent(safe);
          setHtml(safe === "<p></p>" ? "" : safe);
        }
      : null;
    return () => { restoreRef.current = null; };
  }, [editor, restoreRef]);

  return <div className="rich-editor tiptap-rich-editor">
    <RichTextToolbar editor={editor}/>
    <RichTextBubble editor={editor}/>
    <EditorContent editor={editor} style={{ minHeight: `${Math.max(5, rows) * 22}px` }}/>
    <input ref={hiddenInputRef} type="hidden" name={name} value={html} readOnly/>
    <RichTextStatus editor={editor} helper={helper} maxLength={maxLength} initialCharacters={richTextToPlainText(initialHtml).length}/>
  </div>;
}
