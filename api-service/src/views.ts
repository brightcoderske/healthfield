import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  blogPosts, branchInventory, branches, campaigns, categories, chatConversations, chatMessages, healthConditions,
  orderItemFulfilments, orderItems, orders, prescriptions, productHealthConditions, productReviews, products,
  siteSettings, users,
} from "../../db/schema";
import { requireSession } from "./auth";
import { getDb } from "./db";
import { json, publicImageUrl } from "./http";

const adminRoles = ["ADMIN", "SUPER_ADMIN"] as const;
const teamRoles = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;
const productCard = {
  id: products.id, name: products.name, imageUrl: products.imageUrl, price: products.price,
  discountPrice: products.discountPrice, packSize: products.packSize,
};

function images<T extends { imageUrl?: string | null }>(rows: T[]) {
  return rows.map((row) => ({ ...row, imageUrl: publicImageUrl(row.imageUrl) }));
}

async function home() {
  const db = getDb();
  const [rows, mappings, settingsRows, categoryRows, conditionRows] = await Promise.all([
    db.select({
      id: products.id, name: products.name, price: products.price, imageUrl: products.imageUrl,
      packSize: products.packSize, brand: products.brand, categoryId: products.categoryId,
      shortDescription: products.shortDescription, description: products.description, discountPrice: products.discountPrice,
      rating: sql<string | null>`avg(case when ${productReviews.isApproved} = true then ${productReviews.rating} end)`,
      reviewCount: sql<number>`count(case when ${productReviews.isApproved} = true then 1 end)`,
    }).from(products).leftJoin(productReviews, eq(productReviews.productId, products.id))
      .where(eq(products.isActive, true)).groupBy(products.id)
      .orderBy(desc(products.isFeatured), desc(products.createdAt)),
    db.select().from(productHealthConditions),
    db.select().from(siteSettings).limit(1),
    db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories)
      .where(eq(categories.isActive, true)).orderBy(categories.displayOrder),
    db.select({ id: healthConditions.id, name: healthConditions.name, slug: healthConditions.slug }).from(healthConditions)
      .where(eq(healthConditions.isActive, true)).orderBy(healthConditions.displayOrder),
  ]);
  const catalog = rows.map((row) => ({
    ...row,
    imageUrl: publicImageUrl(row.imageUrl),
    price: Number(row.price),
    discountPrice: row.discountPrice === null ? null : Number(row.discountPrice),
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: Number(row.reviewCount),
    conditionIds: mappings.filter((mapping) => mapping.productId === row.id).map((mapping) => mapping.conditionId),
  }));
  const settings = settingsRows[0];
  const contact = settings ? {
    phone: settings.phone ?? "", whatsapp: settings.whatsapp ?? "", supportEmail: settings.supportEmail ?? "",
    address: settings.address ?? "", openingHours: settings.openingHours ?? "", deliveryMessage: settings.deliveryMessage,
    facebookUrl: settings.facebookUrl ?? "", instagramUrl: settings.instagramUrl ?? "",
    xUrl: settings.xUrl ?? "", tiktokUrl: settings.tiktokUrl ?? "", licenceTitle:settings.licenceTitle??"",licenceNumber:settings.licenceNumber??"",licenceImageUrl:publicImageUrl(settings.licenceImageUrl),
  } : { phone: "", whatsapp: "", supportEmail: "", address: "", openingHours: "", deliveryMessage: "Fast Delivery Across Kenya", facebookUrl: "", instagramUrl: "", xUrl: "", tiktokUrl: "",licenceTitle:"",licenceNumber:"",licenceImageUrl:null };
  return { catalog, contact, categories: categoryRows, conditions: conditionRows };
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
  if(path==="blogs")return json({posts:await getDb().select().from(blogPosts).where(eq(blogPosts.isPublished,true)).orderBy(desc(blogPosts.publishedAt))},{headers:{"Cache-Control":"public, max-age=300"}});
  const blogMatch=path.match(/^blogs\/([^/]+)$/);if(blogMatch){const [post]=await getDb().select().from(blogPosts).where(and(eq(blogPosts.slug,decodeURIComponent(blogMatch[1])),eq(blogPosts.isPublished,true))).limit(1);return post?json({post}):json({error:"Article not found."},{status:404})}
  if (path === "catalogue") {
    const ids = idsFrom(url);
    const rows = ids.length
      ? await getDb().select(productCard).from(products).where(and(eq(products.isActive, true), inArray(products.id, ids)))
      : await getDb().select(productCard).from(products).where(eq(products.isActive, true));
    return json({ products: images(rows) });
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
    return json({ catalog: images(catalog), customer: customer ?? null });
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
    if (view === "dashboard") {
      const [[{ newOrders }], [{ pendingPrescriptions }], [{ activeProducts }], [{ lowStock }], [{ customers }], [{ newChats }], recentOrders] = await Promise.all([
        db.select({ newOrders: count() }).from(orders).where(eq(orders.status, "NEW")),
        db.select({ pendingPrescriptions: count() }).from(prescriptions).where(eq(prescriptions.status, "RECEIVED")),
        db.select({ activeProducts: count() }).from(products).where(eq(products.isActive, true)),
        db.select({ lowStock: count() }).from(branchInventory).where(sql`${branchInventory.quantityAvailable} <= ${branchInventory.reorderLevel}`),
        db.select({ customers: count() }).from(users).where(eq(users.role, "CUSTOMER")),
        db.select({ newChats: sql<number>`count(distinct ${chatMessages.conversationId})` }).from(chatMessages).innerJoin(users,eq(users.id,chatMessages.senderId)).where(and(eq(users.role,"CUSTOMER"),isNull(chatMessages.readAt))),
        db.select().from(orders).orderBy(desc(orders.createdAt)).limit(8),
      ]);
      return json({ newOrders, pendingPrescriptions, activeProducts, lowStock, customers, newChats:Number(newChats), recentOrders });
    }
    if (view === "orders") return json({ orders: await db.select().from(orders).orderBy(sql`case when ${orders.status}='NEW' then 0 when ${orders.status} in ('CONFIRMED','UNDER_REVIEW') then 1 else 2 end`,desc(orders.createdAt)) });
    const orderMatch = view.match(/^orders\/(\d+)$/);
    if (orderMatch) {
      const id = Number(orderMatch[1]);
      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) return json({ error: "Order not found." }, { status: 404 });
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
      const [fulfilments, stores, stock] = await Promise.all([
        items.length ? db.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map((item) => item.id))) : [],
        db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.isActive, true)),
        items.some((item) => item.productId !== null) ? db.select({ productId: branchInventory.productId, branchId: branchInventory.branchId, available: branchInventory.quantityAvailable }).from(branchInventory).where(inArray(branchInventory.productId, items.flatMap((item) => item.productId === null ? [] : [item.productId]))) : [],
      ]);
      return json({ order, items, fulfilments, stores, stock });
    }
    if (view === "customers") return json({ customers: await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, isActive: users.isActive, createdAt: users.createdAt }).from(users).where(eq(users.role, "CUSTOMER")).orderBy(desc(users.createdAt)) });
    if (view === "chats") { const [chats,unread]=await Promise.all([db.select({ id: chatConversations.id, status: chatConversations.status, lastMessageAt: chatConversations.lastMessageAt, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(chatConversations).innerJoin(users, eq(users.id, chatConversations.customerId)).orderBy(desc(chatConversations.lastMessageAt)),db.select({conversationId:chatMessages.conversationId,total:count()}).from(chatMessages).innerJoin(users,eq(users.id,chatMessages.senderId)).where(and(eq(users.role,"CUSTOMER"),isNull(chatMessages.readAt))).groupBy(chatMessages.conversationId)]);return json({chats:chats.map(chat=>({...chat,unread:Number(unread.find(row=>row.conversationId===chat.id)?.total||0)}))}); }
    if (view === "prescriptions") return json({ prescriptions: await db.select().from(prescriptions).orderBy(desc(prescriptions.createdAt)) });
    if (view === "campaigns") return json({ campaigns: await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(30) });
    if (view === "stores") return json({ stores: await db.select().from(branches).orderBy(desc(branches.createdAt)) });
    if (view === "staff") {
      const [staff, stores] = await Promise.all([
        db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, role: users.role, homeBranchId: users.homeBranchId, isActive: users.isActive, twoFactorEnabled: users.twoFactorEnabled }).from(users).where(and(ne(users.role, "CUSTOMER"), isNull(users.deletedAt))).orderBy(desc(users.createdAt)),
        db.select({ id: branches.id, name: branches.name }).from(branches),
      ]);
      return json({ staff, stores });
    }
    if (view === "settings") return json({ settings: (await db.select().from(siteSettings).limit(1))[0] ?? null });
    if(view==="blogs")return json({posts:await db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt))});
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
    return json({ prescriptions: await getDb().select().from(prescriptions).orderBy(desc(prescriptions.createdAt)) });
  }
  if (path === "walk-in-sale") {
    const auth = await requireSession(request, [...teamRoles]);
    if ("response" in auth) return auth.response;
    const [branchRows, productRows, stockRows] = await Promise.all([
      getDb().select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.name)),
      getDb().select({ id: products.id, name: products.name, sku: products.sku, price: products.price, discountPrice: products.discountPrice }).from(products).where(eq(products.isActive, true)).orderBy(asc(products.name)),
      getDb().select({ branchId: branchInventory.branchId, productId: branchInventory.productId, available: branchInventory.quantityAvailable }).from(branchInventory),
    ]);
    return json({ branches: branchRows, products: productRows.map((product) => ({ ...product, price: Number(product.price), discountPrice: product.discountPrice === null ? null : Number(product.discountPrice) })), stock: stockRows });
  }
  return json({ error: "View not found." }, { status: 404 });
}
