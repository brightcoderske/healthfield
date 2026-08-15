import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyRichTextToHtml,
  richTextBlocks,
  richTextToPlainText,
  richTextToSafeHtml,
} from "./rich-text-content.ts";

test("legacy product and blog formatting is converted without losing content", () => {
  const legacy = [
    "## Benefits",
    "{color:#c2185b|Pink} {u|underlined} and **bold** text",
    "- First item",
    "- Second item",
    "[Contact us](/contact)",
  ].join("\n");
  const html = legacyRichTextToHtml(legacy);
  assert.match(html, /<h2>Benefits<\/h2>/);
  assert.match(html, /<span style="color: #c2185b">Pink<\/span>/);
  assert.match(html, /<u>underlined<\/u>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul><li>First item<\/li><li>Second item<\/li><\/ul>/);
  assert.match(html, /<a href="\/contact">Contact us<\/a>/);
  assert.equal(richTextToPlainText(legacy), "Benefits Pink underlined and bold text First item Second item Contact us");
});

test("Tiptap formatting survives the display sanitizer", () => {
  const html = richTextToSafeHtml('<h2 style="text-align: center">Title</h2><p><span style="color: #1d4ed8; font-size: 24px; font-family: Georgia">Display text</span> <u>underlined</u> <mark style="background-color: #fff0a6">marked</mark></p>');
  assert.match(html, /text-align:center/);
  assert.match(html, /color:#1d4ed8/);
  assert.match(html, /font-size:24px/);
  assert.match(html, /font-family:Georgia/);
  assert.match(html, /<u>underlined<\/u>/);
  assert.match(html, /background-color:#fff0a6/);
});

test("mixed legacy headings inside HTML are normalized without losing colour", () => {
  const html = richTextToSafeHtml('<h2><span style="color:#b45309">### Existing heading</span></h2><p><span style="color:#15803d">### Paragraph heading</span></p>');
  assert.equal(html, '<h2><span style="color:#b45309">Existing heading</span></h2><h3><span style="color:#15803d">Paragraph heading</span></h3>');
});

test("unsafe tags, attributes, links and styles are removed", () => {
  const hostile = '<script>alert(1)</script><p onclick="steal()" style="position:fixed;text-align:center">Safe</p><a href="javascript:alert(1)">Bad link</a><span style="color:expression(alert(1));font-size:999px;font-family:Evil Font">Text</span>';
  const html = richTextToSafeHtml(hostile);
  assert.doesNotMatch(html, /<script|onclick|javascript:|position|expression|999px|Evil Font/i);
  assert.match(html, /<p style="text-align:center">Safe<\/p>/);
  assert.match(html, /<span>Bad link<\/span>/);
  assert.equal(richTextToPlainText(hostile), "Safe Bad link Text");
});

test("external and internal links receive safe attributes", () => {
  const html = richTextToSafeHtml('<p><a href="https://example.com">External</a> <a href="/products/12">Internal</a></p>');
  assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noreferrer noopener"/);
  assert.match(html, /href="\/products\/12"/);
});

test("article content is split only at safe top-level block boundaries", () => {
  const blocks = richTextBlocks("<h2>Intro</h2><p>One <strong>nested</strong> paragraph.</p><ul><li>A</li><li>B</li></ul>");
  assert.deepEqual(blocks, ["<h2>Intro</h2>", "<p>One <strong>nested</strong> paragraph.</p>", "<ul><li>A</li><li>B</li></ul>"]);
});
