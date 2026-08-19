import { inArray } from "drizzle-orm";
import { blogPosts, offers, products } from "../../db/schema";
import {
  type ContentKind,
  type ContentReference,
  type RenderedContent,
} from "../../lib/campaign-merge";
import { getDb } from "./db";
import { publicImageUrl } from "./http";

/**
 * Turns {product:12}, {offer:5} and {blog:7} into something a customer can act on.
 *
 * Everything is rendered server-side into the email body rather than pulled in by the
 * reader's client: mail clients block scripts outright and most block remote content
 * until the reader allows it, so a card assembled at send time is the only version
 * guaranteed to arrive intact.
 *
 * Every card is wrapped in a link to the live page, so the item opens when tapped.
 */

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: string | number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `KES ${numeric.toLocaleString()}` : "";
}

/**
 * Card markup, built with tables and inline styles.
 *
 * Not a stylistic choice: Outlook still lays out with a Word rendering engine, and most
 * clients strip <style> blocks and ignore flexbox and grid. Tables with inline styles
 * are what actually survives.
 */
function card(input: { url: string; title: string; image: string | null; body: string; price?: string; action: string }): string {
  const image = input.image
    ? `<tr><td style="padding:0"><a href="${escapeHtml(input.url)}" style="display:block"><img src="${escapeHtml(input.image)}" alt="${escapeHtml(input.title)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:10px 10px 0 0" /></a></td></tr>`
    : "";
  const price = input.price ? `<div style="margin:6px 0 0;color:#d92f91;font-size:17px;font-weight:700">${escapeHtml(input.price)}</div>` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:16px 0;border:1px solid #ece9ef;border-radius:12px;background:#ffffff">
  ${image}
  <tr><td style="padding:16px">
    <a href="${escapeHtml(input.url)}" style="color:#181529;font-size:17px;font-weight:700;text-decoration:none">${escapeHtml(input.title)}</a>
    ${price}
    <div style="margin:7px 0 0;color:#544f60;font-size:14px;line-height:1.5">${escapeHtml(input.body)}</div>
    <a href="${escapeHtml(input.url)}" style="display:inline-block;margin-top:13px;padding:10px 20px;border-radius:999px;color:#ffffff;background:#d92f91;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(input.action)} &rarr;</a>
  </td></tr>
</table>`;
}

export type CampaignContentIndex = Map<string, RenderedContent>;

/**
 * Fetches every referenced item in one query per kind and renders each one.
 *
 * Anything missing, inactive or unpublished is simply absent from the index; the
 * template renderer then drops the token rather than showing it to a customer.
 */
export async function loadCampaignContent(
  references: ContentReference[],
  storefrontOrigin: string,
): Promise<CampaignContentIndex> {
  const index: CampaignContentIndex = new Map();
  if (!references.length) return index;
  const db = getDb();
  const origin = storefrontOrigin.replace(/\/$/, "");
  const idsFor = (kind: ContentKind) => references.filter((reference) => reference.kind === kind).map((reference) => reference.id);

  const [productIds, offerIds, blogIds] = [idsFor("product"), idsFor("offer"), idsFor("blog")];

  if (productIds.length) {
    const rows = await db
      .select({ id: products.id, name: products.name, shortDescription: products.shortDescription, imageUrl: products.imageUrl, price: products.price, discountPrice: products.discountPrice, isActive: products.isActive })
      .from(products)
      .where(inArray(products.id, productIds));
    for (const row of rows) {
      if (!row.isActive) continue;
      const url = `${origin}/products/${row.id}`;
      const price = money(row.discountPrice ?? row.price);
      index.set(`product:${row.id}`, {
        html: card({ url, title: row.name, image: publicImageUrl(row.imageUrl), body: row.shortDescription || "", price, action: "Shop now" }),
        text: `${row.name}${price ? ` - ${price}` : ""}: ${url}`,
      });
    }
  }

  if (offerIds.length) {
    const rows = await db
      .select({ id: offers.id, title: offers.title, slug: offers.slug, description: offers.description, imageUrl: offers.imageUrl, isActive: offers.isActive })
      .from(offers)
      .where(inArray(offers.id, offerIds));
    for (const row of rows) {
      if (!row.isActive) continue;
      const url = `${origin}/offers`;
      index.set(`offer:${row.id}`, {
        html: card({ url, title: row.title, image: publicImageUrl(row.imageUrl), body: row.description || "", action: "See the offer" }),
        text: `${row.title}: ${url}`,
      });
    }
  }

  if (blogIds.length) {
    const rows = await db
      .select({ id: blogPosts.id, title: blogPosts.title, slug: blogPosts.slug, excerpt: blogPosts.excerpt, imageUrl: blogPosts.imageUrl, publishedAt: blogPosts.publishedAt })
      .from(blogPosts)
      .where(inArray(blogPosts.id, blogIds));
    for (const row of rows) {
      // An unpublished draft must never be mailed out.
      if (!row.publishedAt) continue;
      const url = `${origin}/blog/${row.slug}`;
      index.set(`blog:${row.id}`, {
        html: card({ url, title: row.title, image: publicImageUrl(row.imageUrl), body: row.excerpt || "", action: "Read the article" }),
        text: `${row.title}: ${url}`,
      });
    }
  }

  return index;
}

export function campaignContentResolver(index: CampaignContentIndex) {
  return (reference: ContentReference) => index.get(`${reference.kind}:${reference.id}`) ?? null;
}
