import assert from "node:assert/strict";
import test from "node:test";
import {
  extractContentReferences,
  isPersonalised,
  longestRenderedLength,
  recipientFirstName,
  recipientFullName,
  renderContentBlocks,
  renderMergeFields,
  type ContentReference,
} from "./campaign-merge.ts";

const context = { pharmacyName: "Healthfield Pharmacy", pharmacyPhone: "0757148900", storefrontUrl: "healthfieldpharmacy.co.ke" };

test("a name token is replaced with the recipient's first name", () => {
  const out = renderMergeFields("Hi {name}, we have an offer.", { firstName: "Grace", lastName: "Wanjiru" }, context);
  assert.equal(out, "Hi Grace, we have an offer.");
});

test("an unknown name never leaves a gap in the sentence", () => {
  // "Hi , we have an offer" is worse than a generic greeting.
  for (const recipient of [{}, { firstName: "" }, { firstName: null }, { fullName: "Walk-in customer" }, { firstName: "G" }]) {
    const out = renderMergeFields("Hi {name}, we have an offer.", recipient, context);
    assert.equal(out, "Hi customer, we have an offer.", `bad fallback for ${JSON.stringify(recipient)}`);
  }
});

test("the token is forgiving about spacing and case", () => {
  assert.equal(renderMergeFields("Hi { Name }!", { firstName: "Grace" }, context), "Hi Grace!");
  assert.equal(renderMergeFields("Hi {NAME}!", { firstName: "Grace" }, context), "Hi Grace!");
});

test("full name falls back sensibly when only one part is known", () => {
  assert.equal(recipientFullName({ firstName: "Grace", lastName: "Wanjiru" }), "Grace Wanjiru");
  assert.equal(recipientFullName({ fullName: "Grace Wanjiru" }), "Grace Wanjiru");
  assert.equal(recipientFullName({ firstName: "Grace" }), "Grace");
  assert.equal(recipientFullName({ fullName: "Walk-in customer" }), "");
  assert.equal(renderMergeFields("Dear {fullname},", { firstName: "Grace" }, context), "Dear Grace,");
});

test("shop details come from settings, not from the copywriter", () => {
  const out = renderMergeFields("{pharmacy} · {phone} · {website}", { firstName: "Grace" }, context);
  assert.equal(out, "Healthfield Pharmacy · 0757148900 · healthfieldpharmacy.co.ke");
});

test("a pharmacy name is never left blank", () => {
  assert.match(renderMergeFields("{pharmacy}", {}, {}), /Healthfield/);
});

test("personalised templates are recognised, so sending can adapt", () => {
  // A bulk SMS goes out as one call with many recipients; a personalised one cannot,
  // because every message body differs. Getting this wrong sends the wrong name.
  assert.equal(isPersonalised("Hi {name}, sale today"), true);
  assert.equal(isPersonalised("Dear {fullname}"), true);
  assert.equal(isPersonalised("Sale today at {pharmacy}"), false);
  assert.equal(isPersonalised("Plain announcement"), false);
});

test("content references are collected once each, in order", () => {
  const refs = extractContentReferences("See {product:12} and {offer:5}, plus {product:12} again, and {blog:7}.");
  assert.deepEqual(refs.map((r) => `${r.kind}:${r.id}`), ["product:12", "offer:5", "blog:7"]);
});

test("content tokens render differently for email and SMS", () => {
  const resolve = (reference: ContentReference) => ({
    html: `<a href="https://example.test/${reference.kind}/${reference.id}">Card ${reference.id}</a>`,
    text: `Item ${reference.id}: https://example.test/${reference.kind}/${reference.id}`,
  });
  const template = "Look at {product:12}!";
  assert.match(renderContentBlocks(template, "EMAIL", resolve), /<a href=/);
  assert.match(renderContentBlocks(template, "SMS", resolve), /Item 12: https/);
  assert.ok(!renderContentBlocks(template, "SMS", resolve).includes("<a"));
});

test("a deleted or unpublished item disappears rather than leaking its token", () => {
  // A customer must never receive the literal text "{product:12}".
  const out = renderContentBlocks("Before {product:12} after", "EMAIL", () => null);
  assert.equal(out, "Before  after");
  assert.ok(!/\{product/.test(out));
});

test("cost is estimated from the longest name, not a comfortable example", () => {
  const template = "Hi {name}, ";
  const recipients = [{ firstName: "Jo" }, { firstName: "Chepkemboi" }, { firstName: "Ann" }];
  // "Chepkemboi" is the one that could tip a message into a second segment.
  assert.equal(longestRenderedLength(template, recipients, context), "Hi Chepkemboi, ".length);
  // With nobody in the audience it still returns a measurable baseline.
  assert.equal(longestRenderedLength(template, [], context), "Hi customer, ".length);
});

test("first-name extraction ignores till placeholders", () => {
  assert.equal(recipientFirstName({ fullName: "Walk-in customer" }), "");
  assert.equal(recipientFirstName({ firstName: "Guest" }), "");
  assert.equal(recipientFirstName({ firstName: "Grace" }), "Grace");
});
