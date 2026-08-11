import { and, asc, count, desc, eq, gte, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import {
  blogPostProducts, blogPosts, branchInventory, branches, campaigns, categories, chatConversations, chatMessages, healthConditions,
  offerItems, offers, orderItemFulfilments, orderItems, orders, paymentTransactions, prescriptions, productHealthConditions, productReviews, products,
  siteSettings, users,
} from "../../db/schema";
import { requireSession } from "./auth";
import { getDb } from "./db";
import { json, publicImageUrl } from "./http";
import { isBundle, loadLiveOffers, normalTotal, offerPriceMap, offerTotal, type ResolvedOffer } from "./offers";
import { paymentConfigurationSummary } from "./payment-handlers";

const adminRoles = ["ADMIN", "SUPER_ADMIN"] as const;
const teamRoles = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;
const productCard = {
  id: products.id, name: products.name, imageUrl: products.imageUrl, price: products.price,
  discountPrice: products.discountPrice, packSize: products.packSize,
};
const searchProductCard = {
  ...productCard,
  brand: products.brand,
  categoryId: products.categoryId,
  shortDescription: products.shortDescription,
  description: products.description,
  rating: sql<string | null>`avg(case when ${productReviews.isApproved} = true then ${productReviews.rating} end)`,
  reviewCount: sql<number>`count(${productReviews.id})`,
};

function images<T extends { imageUrl?: string | null }>(rows: T[]) {
  return rows.map((row) => ({ ...row, imageUrl: publicImageUrl(row.imageUrl) }));
}

/**
 * Shapes an offer for the storefront: public image paths, computed totals, and — since
 * offers carry no artwork of their own — the first product image that exists stands in
 * as the offer's picture.
 */
function offerPayload(offer: ResolvedOffer) {
  const items = offer.items.map((item) => ({ ...item, imageUrl: publicImageUrl(item.imageUrl) }));
  return {
    ...offer,
    items,
    imageUrl: publicImageUrl(offer.imageUrl) ?? items.find((item) => item.imageUrl)?.imageUrl ?? null,
    isBundle: isBundle(offer),
    total: offerTotal(offer),
    normalTotal: normalTotal(offer),
  };
}

async function home() {
  const db = getDb();
  const [rows, mappings, settingsRows, categoryRows, conditionRows, guideRows] = await Promise.all([
    db.select({
      id: products.id, name: products.name, price: products.price, imageUrl: products.imageUrl,
      packSize: products.packSize, brand: products.brand, categoryId: products.categoryId,
      shortDescription: products.shortDescription, description: products.description, discountPrice: products.discountPrice,
      rating: sql<string | null>`avg(case when ${productReviews.isApproved} = true then ${productReviews.rating} end)`,
      reviewCount: sql<number>`count(case when ${productReviews.isApproved} = true then 1 end)`,
    }).from(products).leftJoin(productReviews, eq(productReviews.productId, products.id))
      .where(eq(products.isActive, true)).groupBy(products.id)
      .orderBy(desc(products.isFeatured), desc(products.createdAt)).limit(48),
    db.select().from(productHealthConditions),
    db.select().from(siteSettings).limit(1),
    db.select({ id: categories.id, name: categories.name, slug: categories.slug, featuredOnStorefront: categories.featuredOnStorefront }).from(categories)
      .where(eq(categories.isActive, true)).orderBy(categories.displayOrder),
    db.select({ id: healthConditions.id, name: healthConditions.name, slug: healthConditions.slug }).from(healthConditions)
      .where(eq(healthConditions.isActive, true)).orderBy(healthConditions.displayOrder),
    // Recent guides, used to break up the catalogue scroll with reading material.
    db.select({ id: blogPosts.id, slug: blogPosts.slug, title: blogPosts.title, excerpt: blogPosts.excerpt, imageUrl: blogPosts.imageUrl })
      .from(blogPosts).where(eq(blogPosts.isPublished, true)).orderBy(desc(blogPosts.publishedAt)).limit(4),
  ]);
  const live = await loadLiveOffers();
  const overrides = offerPriceMap(live);
  const catalog = rows.map((row) => {
    // A live single-product offer presents as the selling price. The stored price is
    // left alone, so the moment the offer ends the original pricing is back.
    const offerPrice = overrides.get(row.id);
    const price = Number(row.price);
    const discountPrice = row.discountPrice === null ? null : Number(row.discountPrice);
    return {
      ...row,
      imageUrl: publicImageUrl(row.imageUrl),
      price,
      discountPrice: offerPrice !== undefined ? offerPrice : discountPrice,
      onOffer: offerPrice !== undefined,
      rating: row.rating === null ? null : Number(row.rating),
      reviewCount: Number(row.reviewCount),
      conditionIds: mappings.filter((mapping) => mapping.productId === row.id).map((mapping) => mapping.conditionId),
    };
  });
  const settings = settingsRows[0];
  const contact = settings ? {
    phone: settings.phone ?? "", whatsapp: settings.whatsapp ?? "", supportEmail: settings.supportEmail ?? "",
    address: settings.address ?? "", openingHours: settings.openingHours ?? "", deliveryMessage: settings.deliveryMessage,
    facebookUrl: settings.facebookUrl ?? "", instagramUrl: settings.instagramUrl ?? "",
    xUrl: settings.xUrl ?? "", tiktokUrl: settings.tiktokUrl ?? "", licenceTitle:settings.licenceTitle??"",licenceNumber:settings.licenceNumber??"",licenceImageUrl:publicImageUrl(settings.licenceImageUrl),
  } : { phone: "", whatsapp: "", supportEmail: "", address: "", openingHours: "", deliveryMessage: "Fast Delivery Across Kenya", facebookUrl: "", instagramUrl: "", xUrl: "", tiktokUrl: "",licenceTitle:"",licenceNumber:"",licenceImageUrl:null };
  return { offers: live.map(offerPayload), catalog, contact, categories: categoryRows, conditions: conditionRows, guides: guideRows.map((guide) => ({ ...guide, imageUrl: publicImageUrl(guide.imageUrl) })) };
}

async function productDetail(id: number) {
  const db = getDb();
  const [product] = await db.select().from(products).where(and(eq(products.id, id), eq(products.isActive, true))).limit(1);
  if (!product) return null;
  const [reviewSummary, reviews, conditionLinks, orderLinks] = await Promise.all([
    db.select({ rating: sql<string | null>`avg(${productReviews.rating})`, count: sql<number>`count(*)` })
      .from(productReviews).where(and(eq(productReviews.productId, id), eq(productReviews.isApproved, true))).then((rows) => rows[0]),
    db.select({ id: productReviews.id, rating: productReviews.rating, comment: productReviews.comment, createdAt: productReviews.createdAt, firstName: users.firstName }).from(productReviews).innerJoin(users, eq(users.id, productReviews.customerId)).where(and(eq(productReviews.productId, id), eq(productReviews.isApproved, true))).orderBy(desc(productReviews.createdAt)).limit(20),
    db.select({ conditionId: productHealthConditions.conditionId }).from(productHealthConditions).where(eq(productHealthConditions.productId, id)),
    db.select({ orderId: orderItems.orderId }).from(orderItems).where(eq(orderItems.productId, id)).limit(100),
  ]);
  const [related, similar, bought] = await Promise.all([
    db.select(productCard).from(products).where(and(eq(products.categoryId, product.categoryId), eq(products.isActive, true), ne(products.id, id))).orderBy(desc(products.isFeatured), desc(products.createdAt)).limit(10),
    conditionLinks.length ? db.select(productCard).from(products).innerJoin(productHealthConditions, eq(productHealthConditions.productId, products.id)).where(and(inArray(productHealthConditions.conditionId, conditionLinks.map((row) => row.conditionId)), eq(products.isActive, true), ne(products.id, id))).groupBy(products.id).orderBy(desc(products.isFeatured)).limit(10) : Promise.resolve([]),
    orderLinks.length ? db.select({ ...productCard, purchases: sql<number>`sum(${orderItems.quantity})` }).from(orderItems).innerJoin(products, eq(products.id, orderItems.productId)).where(and(inArray(orderItems.orderId, orderLinks.map((row) => row.orderId)), ne(products.id, id), eq(products.isActive, true))).groupBy(products.id).orderBy(desc(sql<number>`sum(${orderItems.quantity})`)).limit(10) : Promise.resolve([]),
  ]);
  const normalizedRelated = images(related);
  const normalizedSimilar = images(similar);
  const filteredSimilar = normalizedSimilar.filter((item) => !normalizedRelated.some((relatedItem) => relatedItem.id === item.id));
  return {
    product: { ...product, imageUrl: publicImageUrl(product.imageUrl) },
    rating: reviewSummary?.rating === null ? null : Number(reviewSummary?.rating),
    reviewCount: Number(reviewSummary?.count ?? 0),
    reviews,
    related: normalizedRelated,
    similar: filteredSimilar.length ? filteredSimilar : normalizedRelated.slice().reverse(),
    bought: bought.length ? images(bought) : normalizedRelated.slice(0, 6),
  };
}

function idsFrom(url: URL) {
  return (url.searchParams.get("ids") || "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 100);
}

function searchTerms(value: string) {
  return value.toLowerCase().trim().split(/\s+/).map((term) => term.replace(/[^\p{L}\p{N}-]/gu, "")).filter((term) => term.length > 1).slice(0, 6);
}

function matchesEveryTerm(terms: string[]) {
  return terms.map((term) => {
    const match = `%${term}%`;
    return or(like(products.name, match), like(products.brand, match), like(products.shortDescription, match), like(products.description, match));
  });
}

async function requireAdmin(request: Request) {
  return requireSession(request, [...adminRoles]);
}

export async function handleView(request: Request, path: string) {
  const url = new URL(request.url);
  if (path === "home") return json(await home(), { headers: { "Cache-Control": "public, max-age=30" } });
  if (path === "locations") {
    const stores = await getDb().select({ id:branches.id,name:branches.name,code:branches.code,phone:branches.phone,email:branches.email,address:branches.address,latitude:branches.latitude,longitude:branches.longitude,openingHours:branches.openingHours,deliveryAreas:branches.deliveryAreas,updatedAt:branches.updatedAt }).from(branches).where(eq(branches.isActive,true)).orderBy(asc(branches.name));
    return json({ stores }, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  if (path === "conditions") {
    const rows = await getDb().select().from(healthConditions).where(eq(healthConditions.isActive, true)).orderBy(asc(healthConditions.displayOrder), asc(healthConditions.name));
    return json({ conditions: rows }, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  if(path==="blogs"){
    const rows=await getDb().select().from(blogPosts).where(eq(blogPosts.isPublished,true)).orderBy(desc(blogPosts.publishedAt));
    // Reading time is derived here so the index never has to ship article bodies.
    const posts=rows.map(({content,...post})=>({...post,imageUrl:publicImageUrl(post.imageUrl),readMinutes:Math.max(1,Math.round(content.trim().split(/\s+/).length/200))}));
    return json({posts},{headers:{"Cache-Control":"public, max-age=300"}});
  }
  const blogMatch=path.match(/^blogs\/([^/]+)$/);
  if(blogMatch){
    const db=getDb();
    const [post]=await db.select().from(blogPosts).where(and(eq(blogPosts.slug,decodeURIComponent(blogMatch[1])),eq(blogPosts.isPublished,true))).limit(1);
    if(!post)return json({error:"Article not found."},{status:404});
    // Promoted products are resolved live so a de-listed item stops appearing in
    // older articles without anyone editing them.
    const promoted=await db.select({id:products.id,name:products.name,imageUrl:products.imageUrl,price:products.price,discountPrice:products.discountPrice,packSize:products.packSize})
      .from(blogPostProducts).innerJoin(products,eq(products.id,blogPostProducts.productId))
      .where(and(eq(blogPostProducts.postId,post.id),eq(products.isActive,true)))
      .orderBy(asc(blogPostProducts.displayOrder));
    return json({post,products:promoted.map((row)=>({...row,imageUrl:publicImageUrl(row.imageUrl)}))});
  }
  if (path === "search") {
    const terms = searchTerms(url.searchParams.get("q") || "");
    if (!terms.length) return json({ products: [], similar: [] }, { headers: { "Cache-Control": "no-store" } });
    const matching = matchesEveryTerm(terms);
    const anyMatch = or(...matching);
    const [exact, alternatives] = await Promise.all([
      getDb().select(searchProductCard).from(products).leftJoin(productReviews, eq(productReviews.productId, products.id)).where(and(eq(products.isActive, true), ...matching)).groupBy(products.id).orderBy(desc(products.isFeatured), desc(products.createdAt)).limit(48),
      getDb().select(searchProductCard).from(products).leftJoin(productReviews, eq(productReviews.productId, products.id)).where(and(eq(products.isActive, true), anyMatch)).groupBy(products.id).orderBy(desc(products.isFeatured), desc(products.createdAt)).limit(12),
    ]);
    const all = [...exact, ...alternatives];
    const mappings = all.length ? await getDb().select().from(productHealthConditions).where(inArray(productHealthConditions.productId, [...new Set(all.map((product) => product.id))])) : [];
    const shape = (rows: typeof all) => rows.map((product) => ({
      ...product,
      imageUrl: publicImageUrl(product.imageUrl),
      price: Number(product.price),
      discountPrice: product.discountPrice === null ? null : Number(product.discountPrice),
      rating: product.rating === null ? null : Number(product.rating),
      reviewCount: Number(product.reviewCount),
      conditionIds: mappings.filter((mapping) => mapping.productId === product.id).map((mapping) => mapping.conditionId),
    }));
    const exactIds = new Set(exact.map((product) => product.id));
    return json({ products: shape(exact), similar: shape(alternatives.filter((product) => !exactIds.has(product.id)).slice(0, 6)) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (path === "catalogue") {
    const ids = idsFrom(url);
    const rows = ids.length
      ? await getDb().select(productCard).from(products).where(and(eq(products.isActive, true), inArray(products.id, ids)))
      : await getDb().select(productCard).from(products).where(eq(products.isActive, true));
    // The cart needs live bundles alongside the products it asked for.
    const liveBundles = (await loadLiveOffers()).filter(isBundle).map(offerPayload);
    return json({ products: images(rows), offers: liveBundles });
  }
  const productMatch = path.match(/^products\/(\d+)$/);
  if (productMatch) {
    const detail = await productDetail(Number(productMatch[1]));
    return detail ? json(detail, { headers: { "Cache-Control": "public, max-age=60" } }) : json({ error: "Product not found." }, { status: 404 });
  }
  if (path === "account") {
    const auth = await requireSession(request, ["CUSTOMER"]);
    if ("response" in auth) return auth.response;
    const db = getDb();
    const [orderRows, catalog, prescriptionRows] = await Promise.all([
      db.select().from(orders).where(eq(orders.customerId, auth.session.userId)).orderBy(desc(orders.createdAt)),
      db.select(productCard).from(products).where(eq(products.isActive, true)).orderBy(desc(products.isFeatured), desc(products.createdAt)).limit(24),
      db.select({id:prescriptions.id,originalFilename:prescriptions.originalFilename,status:prescriptions.status,pharmacistNotes:prescriptions.pharmacistNotes,createdAt:prescriptions.createdAt,reviewedAt:prescriptions.reviewedAt}).from(prescriptions).where(eq(prescriptions.customerId,auth.session.userId)).orderBy(desc(prescriptions.createdAt)),
    ]);
    return json({ orders: orderRows, catalog: images(catalog), prescriptions:prescriptionRows });
  }
  const customerOrderMatch = path.match(/^account\/orders\/(\d+)$/);
  if (customerOrderMatch) {
    const auth = await requireSession(request, ["CUSTOMER"]);
    if ("response" in auth) return auth.response;
    const id = Number(customerOrderMatch[1]);
    const db = getDb();
    const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.customerId, auth.session.userId))).limit(1);
    if (!order) return json({ error: "Order not found." }, { status: 404 });
    return json({ order, items: await db.select().from(orderItems).where(eq(orderItems.orderId, id)) });
  }
  if (path === "checkout") {
    const ids = idsFrom(url);
    const auth = await requireSession(request);
    const session = "session" in auth ? auth.session : null;
    const db = getDb();
    const catalog = ids.length ? await db.select(productCard).from(products).where(inArray(products.id, ids)) : [];
    const [customer] = session?.role === "CUSTOMER"
      ? await db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone }).from(users).where(eq(users.id, session.userId)).limit(1)
      : [null];
    const [settings] = await db.select({ onlineMpesaEnabled: siteSettings.onlineMpesaEnabled, onlineManualEnabled: siteSettings.onlineManualEnabled, mpesaTillNumber: siteSettings.mpesaTillNumber, mpesaAccountName: siteSettings.mpesaAccountName }).from(siteSettings).limit(1);
    // Bundles are resolved server-side so checkout prices what is live right now
    // rather than whatever the basket cookie remembers.
    const liveOffers = (await loadLiveOffers()).filter(isBundle).map(offerPayload);
    return json({ catalog: images(catalog), offers: liveOffers, customer: customer ?? null, payment: { onlineMpesaEnabled: Boolean(settings?.onlineMpesaEnabled && paymentConfigurationSummary().mpesaConfigured), onlineManualEnabled: Boolean(settings?.onlineManualEnabled && settings.mpesaTillNumber), tillNumber: settings?.mpesaTillNumber || null, accountName: settings?.mpesaAccountName || null } });
  }
  if (path === "sitemap") {
    const productRows = await getDb().select({ id: products.id, updatedAt: products.updatedAt }).from(products).where(eq(products.isActive, true));
    return json({ products: productRows }, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  if (path === "merchant") {
    const rows = await getDb().select({ id:products.id,sku:products.sku,name:products.name,description:products.description,imageUrl:products.imageUrl,price:products.price,discountPrice:products.discountPrice,brand:products.brand,barcode:products.barcode,packSize:products.packSize,category:categories.name,prescriptionRequired:products.prescriptionRequired,rating:sql<string|null>`avg(case when ${productReviews.isApproved}=true then ${productReviews.rating} end)`,reviewCount:sql<number>`count(case when ${productReviews.isApproved}=true then 1 end)` }).from(products).innerJoin(categories,eq(categories.id,products.categoryId)).leftJoin(productReviews,eq(productReviews.productId,products.id)).where(eq(products.isActive,true)).groupBy(products.id,categories.name);
    return json({ products: rows.map((row)=>({...row,imageUrl:publicImageUrl(row.imageUrl)})) }, { headers: { "Cache-Control": "public, max-age=300" } });
  }

  if (path.startsWith("admin/")) {
    const auth = await requireAdmin(request);
    if ("response" in auth) return auth.response;
    const db = getDb();
    const view = path.slice(6);
    if (view === "navigation") {
      const [[{ newOrders }], [{ newChats }]] = await Promise.all([
        db.select({ newOrders: count() }).from(orders).where(eq(orders.status, "NEW")),
        db.select({ newChats: sql<number>`count(distinct ${chatMessages.conversationId})` }).from(chatMessages).innerJoin(users,eq(users.id,chatMessages.senderId)).where(and(eq(users.role,"CUSTOMER"),isNull(chatMessages.readAt))),
      ]);
      return json({ newOrders: Number(newOrders), newChats: Number(newChats) });
    }
    if (view === "dashboard") {
      const since = new Date(Date.now() - 92 * 24 * 60 * 60 * 1000);
      const [[{ newOrders }], [{ pendingPrescriptions }], [{ activeProducts }], [{ lowStock }], [{ customers }], [{ newChats }], recentOrders, analytics] = await Promise.all([
        db.select({ newOrders: count() }).from(orders).where(eq(orders.status, "NEW")),
        db.select({ pendingPrescriptions: count() }).from(prescriptions).where(eq(prescriptions.status, "RECEIVED")),
        db.select({ activeProducts: count() }).from(products).where(eq(products.isActive, true)),
        db.select({ lowStock: count() }).from(branchInventory).where(sql`${branchInventory.quantityAvailable} <= ${branchInventory.reorderLevel}`),
        db.select({ customers: count() }).from(users).where(eq(users.role, "CUSTOMER")),
        db.select({ newChats: sql<number>`count(distinct ${chatMessages.conversationId})` }).from(chatMessages).innerJoin(users,eq(users.id,chatMessages.senderId)).where(and(eq(users.role,"CUSTOMER"),isNull(chatMessages.readAt))),
        db.select().from(orders).orderBy(desc(orders.createdAt)).limit(8),
        db.select({ orderId: orders.id, createdAt: orders.createdAt, status: orders.status, total: orders.total, branch: branches.name, productName: orderItems.productName, quantity: orderItems.quantity, lineTotal: orderItems.lineTotal, category: categories.name }).from(orders).innerJoin(orderItems, eq(orderItems.orderId, orders.id)).leftJoin(products, eq(products.id, orderItems.productId)).leftJoin(categories, eq(categories.id, products.categoryId)).leftJoin(branches, eq(branches.id, orders.suggestedBranchId)).where(and(gte(orders.createdAt, since), ne(orders.status, "CANCELLED"))),
      ]);
      return json({ newOrders, pendingPrescriptions, activeProducts, lowStock, customers, newChats:Number(newChats), recentOrders, analytics });
    }
    if (view === "orders") return json({ orders: await db.select().from(orders).orderBy(sql`case when ${orders.status}='NEW' then 0 when ${orders.status} in ('CONFIRMED','UNDER_REVIEW') then 1 else 2 end`,desc(orders.createdAt)) });
    const orderMatch = view.match(/^orders\/(\d+)$/);
    if (orderMatch) {
      const id = Number(orderMatch[1]);
      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) return json({ error: "Order not found." }, { status: 404 });
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
      const [fulfilments, stores, stock, payments] = await Promise.all([
        items.length ? db.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map((item) => item.id))) : [],
        db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.isActive, true)),
        items.some((item) => item.productId !== null) ? db.select({ productId: branchInventory.productId, branchId: branchInventory.branchId, available: sql<number>`${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}` }).from(branchInventory).where(inArray(branchInventory.productId, items.flatMap((item) => item.productId === null ? [] : [item.productId]))) : [],
        db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, id)).orderBy(desc(paymentTransactions.createdAt)),
      ]);
      return json({ order, items, fulfilments, stores, stock, payments });
    }
    if (view === "customers") return json({ customers: await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, isActive: users.isActive, createdAt: users.createdAt }).from(users).where(eq(users.role, "CUSTOMER")).orderBy(desc(users.createdAt)) });
    const customerMatch = view.match(/^customers\/(\d+)$/);
    if (customerMatch) {
      const customerId = Number(customerMatch[1]);
      const [customer] = await db.select({ id:users.id, firstName:users.firstName, lastName:users.lastName, email:users.email, phone:users.phone, isActive:users.isActive, emailVerifiedAt:users.emailVerifiedAt, createdAt:users.createdAt }).from(users).where(and(eq(users.id, customerId), eq(users.role, "CUSTOMER"))).limit(1);
      if (!customer) return json({ error:"Customer not found." }, { status:404 });
      const [customerOrders, customerPrescriptions] = await Promise.all([
        db.select({ id:orders.id, orderNumber:orders.orderNumber, status:orders.status, paymentStatus:orders.paymentStatus, paymentMethod:orders.paymentMethod, total:orders.total, createdAt:orders.createdAt }).from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt)),
        db.select({ id:prescriptions.id, orderId:prescriptions.orderId, originalFilename:prescriptions.originalFilename, status:prescriptions.status, pharmacistNotes:prescriptions.pharmacistNotes, createdAt:prescriptions.createdAt }).from(prescriptions).where(eq(prescriptions.customerId, customerId)).orderBy(desc(prescriptions.createdAt)),
      ]);
      return json({ customer, orders:customerOrders, prescriptions:customerPrescriptions });
    }
    if (view === "chats") { const [chats,unread]=await Promise.all([db.select({ id: chatConversations.id, status: chatConversations.status, lastMessageAt: chatConversations.lastMessageAt, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(chatConversations).innerJoin(users, eq(users.id, chatConversations.customerId)).orderBy(desc(chatConversations.lastMessageAt)),db.select({conversationId:chatMessages.conversationId,total:count()}).from(chatMessages).innerJoin(users,eq(users.id,chatMessages.senderId)).where(and(eq(users.role,"CUSTOMER"),isNull(chatMessages.readAt))).groupBy(chatMessages.conversationId)]);return json({chats:chats.map(chat=>({...chat,unread:Number(unread.find(row=>row.conversationId===chat.id)?.total||0)}))}); }
    if (view === "prescriptions") return json({ prescriptions: await db.select({ id: prescriptions.id, customerId: prescriptions.customerId, orderId: prescriptions.orderId, senderName: sql<string | null>`coalesce(${prescriptions.senderName}, trim(concat(${users.firstName}, ' ', ${users.lastName})))`, storageKey: prescriptions.storageKey, originalFilename: prescriptions.originalFilename, mimeType: prescriptions.mimeType, sizeBytes: prescriptions.sizeBytes, status: prescriptions.status, pharmacistNotes: prescriptions.pharmacistNotes, reviewedBy: prescriptions.reviewedBy, reviewedAt: prescriptions.reviewedAt, createdAt: prescriptions.createdAt, updatedAt: prescriptions.updatedAt }).from(prescriptions).leftJoin(users, eq(users.id, prescriptions.customerId)).orderBy(desc(prescriptions.createdAt)) });
    if (view === "campaigns") return json({ campaigns: await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(30) });
    if (view === "stores") return json({ stores: await db.select().from(branches).orderBy(desc(branches.createdAt)) });
    if (view === "staff") {
      const [staff, stores] = await Promise.all([
        db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, role: users.role, homeBranchId: users.homeBranchId, isActive: users.isActive, twoFactorEnabled: users.twoFactorEnabled }).from(users).where(and(ne(users.role, "CUSTOMER"), isNull(users.deletedAt))).orderBy(desc(users.createdAt)),
        db.select({ id: branches.id, name: branches.name }).from(branches),
      ]);
      return json({ staff, stores });
    }
    if (view === "settings") return json({ settings: (await db.select().from(siteSettings).limit(1))[0] ?? null, paymentRuntime: paymentConfigurationSummary() });
    if(view==="offers"){
      // Every offer regardless of state, so an administrator can revive an expired one.
      const [offerRows,memberRows,catalogue]=await Promise.all([
        db.select().from(offers).orderBy(asc(offers.displayOrder),desc(offers.id)),
        db.select().from(offerItems).orderBy(asc(offerItems.displayOrder),asc(offerItems.id)),
        db.select({id:products.id,name:products.name,imageUrl:products.imageUrl,price:products.price,discountPrice:products.discountPrice}).from(products).where(eq(products.isActive,true)).orderBy(asc(products.name)),
      ]);
      return json({
        offers:offerRows.map((offer)=>({...offer,items:memberRows.filter((member)=>member.offerId===offer.id).map((member)=>({productId:member.productId,offerPrice:member.offerPrice,quantity:member.quantity}))})),
        products:catalogue.map((row)=>({...row,imageUrl:publicImageUrl(row.imageUrl)})),
      });
    }
    if(view==="blogs"){
      const [posts,links,catalogue]=await Promise.all([
        db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt)),
        db.select({postId:blogPostProducts.postId,productId:blogPostProducts.productId}).from(blogPostProducts).orderBy(asc(blogPostProducts.displayOrder)),
        db.select({id:products.id,name:products.name,imageUrl:products.imageUrl,price:products.price,discountPrice:products.discountPrice}).from(products).where(eq(products.isActive,true)).orderBy(asc(products.name)),
      ]);
      return json({
        posts:posts.map((post)=>({...post,productIds:links.filter((link)=>link.postId===post.id).map((link)=>link.productId)})),
        products:catalogue.map((row)=>({...row,imageUrl:publicImageUrl(row.imageUrl)})),
      });
    }
    if (view === "products") {
      const [catalog, categoryRows, conditions, mappings] = await Promise.all([
        db.select().from(products).orderBy(desc(products.createdAt)),
        db.select().from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.displayOrder)),
        db.select().from(healthConditions).where(eq(healthConditions.isActive, true)).orderBy(asc(healthConditions.displayOrder)),
        db.select().from(productHealthConditions),
      ]);
      return json({
        products: catalog.map((product) => ({ ...product, imageUrl: publicImageUrl(product.imageUrl), price: Number(product.price), discountPrice: product.discountPrice ? Number(product.discountPrice) : null, conditionIds: mappings.filter((mapping) => mapping.productId === product.id).map((mapping) => mapping.conditionId) })),
        categories: categoryRows,
        conditions,
      });
    }
    if (view === "inventory") {
      const [catalog, stock, sales] = await Promise.all([
        db.select({ id: products.id, name: products.name, imageUrl: products.imageUrl, brand: products.brand, packSize: products.packSize, isActive: products.isActive }).from(products).orderBy(asc(products.name)),
        db.select({ id: branchInventory.id, productId: branchInventory.productId, branchId: branches.id, branch: branches.name, available: branchInventory.quantityAvailable, reserved: branchInventory.quantityReserved, reorder: branchInventory.reorderLevel }).from(branchInventory).innerJoin(branches, eq(branchInventory.branchId, branches.id)),
        db.select({ productId: orderItems.productId, sold: sql<number>`coalesce(sum(${orderItems.quantity}),0)` }).from(orderItems).groupBy(orderItems.productId),
      ]);
      return json({ products: images(catalog).map((product) => ({ ...product, stores: stock.filter((row) => row.productId === product.id), sold: Number(sales.find((row) => row.productId === product.id)?.sold || 0) })) });
    }
    return json({ error: "Admin view not found." }, { status: 404 });
  }

  if (path === "staff/dashboard") {
    const auth = await requireSession(request, [...teamRoles]);
    if ("response" in auth) return auth.response;
    const db = getDb();
    const [[{ newOrders }], [{ pending }], [{ lowStock }], queue] = await Promise.all([
      db.select({ newOrders: count() }).from(orders).where(eq(orders.status, "NEW")),
      db.select({ pending: count() }).from(prescriptions).where(eq(prescriptions.status, "RECEIVED")),
      db.select({ lowStock: count() }).from(branchInventory).where(sql`${branchInventory.quantityAvailable} <= ${branchInventory.reorderLevel}`),
      db.select().from(orders).orderBy(desc(orders.createdAt)).limit(10),
    ]);
    return json({ newOrders, pending, lowStock, queue });
  }
  if (path === "staff/prescriptions") {
    const auth = await requireSession(request, [...teamRoles]);
    if ("response" in auth) return auth.response;
    return json({ prescriptions: await getDb().select({ id: prescriptions.id, customerId: prescriptions.customerId, orderId: prescriptions.orderId, senderName: sql<string | null>`coalesce(${prescriptions.senderName}, trim(concat(${users.firstName}, ' ', ${users.lastName})))`, storageKey: prescriptions.storageKey, originalFilename: prescriptions.originalFilename, mimeType: prescriptions.mimeType, sizeBytes: prescriptions.sizeBytes, status: prescriptions.status, pharmacistNotes: prescriptions.pharmacistNotes, reviewedBy: prescriptions.reviewedBy, reviewedAt: prescriptions.reviewedAt, createdAt: prescriptions.createdAt, updatedAt: prescriptions.updatedAt }).from(prescriptions).leftJoin(users, eq(users.id, prescriptions.customerId)).orderBy(desc(prescriptions.createdAt)) });
  }
  if (path === "walk-in-sale") {
    const auth = await requireSession(request, [...teamRoles]);
    if ("response" in auth) return auth.response;
    const [branchRows, productRows, stockRows, paymentRows] = await Promise.all([
      getDb().select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.name)),
      getDb().select({ id: products.id, name: products.name, sku: products.sku, price: products.price, discountPrice: products.discountPrice }).from(products).where(eq(products.isActive, true)).orderBy(asc(products.name)),
      getDb().select({ branchId: branchInventory.branchId, productId: branchInventory.productId, available: sql<number>`${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}` }).from(branchInventory),
      getDb().select({ posCashEnabled: siteSettings.posCashEnabled, posMpesaEnabled: siteSettings.posMpesaEnabled, posManualEnabled: siteSettings.posManualEnabled, mpesaTillNumber: siteSettings.mpesaTillNumber, mpesaAccountName: siteSettings.mpesaAccountName }).from(siteSettings).limit(1),
    ]);
    return json({ branches: branchRows, products: productRows.map((product) => ({ ...product, price: Number(product.price), discountPrice: product.discountPrice === null ? null : Number(product.discountPrice) })), stock: stockRows, payment: { cashEnabled: paymentRows[0]?.posCashEnabled ?? true, mpesaEnabled: Boolean(paymentRows[0]?.posMpesaEnabled && paymentConfigurationSummary().mpesaConfigured), manualEnabled: Boolean(paymentRows[0]?.posManualEnabled && paymentRows[0]?.mpesaTillNumber), tillNumber: paymentRows[0]?.mpesaTillNumber || null, accountName: paymentRows[0]?.mpesaAccountName || null } });
  }
  return json({ error: "View not found." }, { status: 404 });
}
