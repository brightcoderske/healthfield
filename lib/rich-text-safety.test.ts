import assert from "node:assert/strict";
import test from "node:test";

// The renderer is a React component, so the two validators it relies on are
// mirrored here. They are the whole security boundary for author-supplied links
// and colours, so they get their own coverage.
function safeHref(value: string) {
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^tel:/i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return null;
}
function safeColour(value: string) {
  return /^#[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(value.trim()) ? value.trim() : null;
}

test("scripting and protocol-relative URLs are refused", () => {
  const hostile = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)  ",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "//evil.example.com",
    "file:///etc/passwd",
  ];
  for (const url of hostile) assert.equal(safeHref(url), null, `${url} must not become a link`);
});

test("ordinary destinations are allowed", () => {
  for (const url of ["https://example.com/a", "http://example.com", "mailto:hi@example.com", "tel:+254700000000", "/products/12"]) {
    assert.ok(safeHref(url), `${url} should be linkable`);
  }
});

test("only plain hex colours reach the style attribute", () => {
  for (const value of ["#fff", "#c2185b", "#c2185bff"]) assert.equal(safeColour(value), value);
  for (const value of ["red", "url(x)", "expression(alert(1))", "#12", "#gggggg", "rgb(0,0,0)", "#c2185b;position:fixed"]) {
    assert.equal(safeColour(value), null, `${value} must be rejected`);
  }
});
