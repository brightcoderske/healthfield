import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt, { hash } from "bcryptjs";
import { and, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import {
  branches, branchInventory, campaigns, chatConversations, chatMessages, orderItems, orders,
  categories, healthConditions, prescriptions, productHealthConditions, productReviews, products, siteSettings, users,
} from "../../db/schema";
import { createPasswordResetToken, createSessionToken, requireSession, requestSession, verifyPasswordResetToken } from "./auth";
import { getDb } from "./db";
import { orderEmailHtml, sendBulkEmail, sendEmail } from "./email";
import { json, publicImageUrl, safeFilename } from "./http";

const admins = ["ADMIN", "SUPER_ADMIN"] as const;
const team = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;
const orderStatuses = ["NEW", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"] as const;

function storefrontOrigin() {
  return (process.env.APP_URL || process.env.STOREFRONT_URL || "https://healthfieldpharmacy.co.ke").replace(/\/$/, "");
}

async function body(request: Request) {
  return request.json().catch(() => null);
}

export async function handleAuth(request: Request, action: string) {
  const db = getDb();
  if (action === "login" && request.method === "POST") {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8).max(128) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Enter a valid email and password." }, { status: 400 });
    const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
    const valid = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : await bcrypt.compare(parsed.data.password, "$2b$12$1BVjhn5Hc7qJCnn84gWmTOj3DdbFI4zmL.RXsnXC6CIscSwMPxYjC");
    if (!user || !valid || !user.isActive) return json({ error: "Incorrect email or password." }, { status: 401 });
    const session = { userId: user.id, email: user.email, firstName: user.firstName, role: user.role, forcePasswordChange: user.forcePasswordChange };
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    if (user.role === "CUSTOMER") await db.update(orders).set({ customerId: user.id }).where(and(isNull(orders.customerId), eq(orders.email, user.email)));
    const when = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
    void sendEmail({ to: user.email, subject: "Healthfield Pharmacy sign-in", message: `Hello ${user.firstName},\n\nYour Healthfield Pharmacy account was signed in at ${when} (East Africa Time).\n\nIf this was not you, reset your password immediately from the login page.` });
    if (process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: `Sign-in: ${user.email}`, message: `${user.firstName} ${user.lastName} (${user.role}) signed in at ${when}.\nEmail: ${user.email}` });
    return json({ token: await createSessionToken(session), session, role: user.role, redirectTo: user.forcePasswordChange ? "/change-password" : user.role === "CUSTOMER" ? "/#products" : user.role === "STAFF" ? "/staff" : "/admin" });
  }
  if (action === "forgot-password" && request.method === "POST") {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Enter a valid email address." }, { status: 400 });
    const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
    if (user?.isActive) {
      const token = await createPasswordResetToken({ userId: user.id, email: user.email });
      const resetUrl = `${storefrontOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
      await sendEmail({ to: user.email, subject: "Reset your Healthfield Pharmacy password", message: `Hello ${user.firstName},\n\nUse this link to choose a new password. It expires in one hour.\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.` });
    }
    return json({ ok: true, message: "If this email is registered, reset instructions will be sent." });
  }
  if (action === "reset-password" && request.method === "POST") {
    const parsed = z.object({ token: z.string().min(20), newPassword: z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Use a strong new password." }, { status: 400 });
    const reset = await verifyPasswordResetToken(parsed.data.token);
    if (!reset) return json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    const [user] = await db.select().from(users).where(and(eq(users.id, reset.userId), eq(users.email, reset.email))).limit(1);
    if (!user || !user.isActive) return json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    await db.update(users).set({ passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), forcePasswordChange: false }).where(eq(users.id, user.id));
    void sendEmail({ to: user.email, subject: "Your Healthfield password was changed", message: `Hello ${user.firstName},\n\nYour Healthfield Pharmacy password was changed successfully. If you did not do this, contact the pharmacy immediately.` });
    return json({ ok: true, message: "Password updated. You can sign in with your new password." });
  }
  if (action === "register" && request.method === "POST") {
    const parsed = z.object({
      firstName: z.string().trim().min(2).max(100), lastName: z.string().trim().min(2).max(100),
      email: z.string().trim().toLowerCase().email(), phone: z.string().trim().min(9).max(30),
      password: z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
      acceptTerms: z.literal(true), marketingConsent: z.boolean().default(false),
    }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Complete every field and use a strong password." }, { status: 400 });
    const [existing] = await db.select({ email: users.email, phone: users.phone }).from(users).where(or(eq(users.email, parsed.data.email), eq(users.phone, parsed.data.phone))).limit(1);
    if (existing?.email === parsed.data.email) return json({ error: "An account already uses this email." }, { status: 409 });
    if (existing?.phone === parsed.data.phone) return json({ error: "An account already uses this phone number." }, { status: 409 });
    const { acceptTerms: _acceptTerms, password, ...customer } = parsed.data;
    let created;
    try {
      [created] = await db.insert(users).values({ ...customer, passwordHash: await bcrypt.hash(password, 12), role: "CUSTOMER", isActive: true, twoFactorEnabled: false, forcePasswordChange: false, termsAcceptedAt: new Date(), marketingConsentAt: customer.marketingConsent ? new Date() : null });
    } catch (error) {
      console.error("Customer registration insert failed", error);
      return json({ error: "That email address or phone number is already registered." }, { status: 409 });
    }
    await db.update(orders).set({ customerId: created.insertId }).where(and(isNull(orders.customerId), eq(orders.email, customer.email)));
    const session = { userId: created.insertId, email: customer.email, firstName: customer.firstName, role: "CUSTOMER" as const, forcePasswordChange: false };
    await sendEmail({ to: customer.email, subject: "Welcome to Healthfield Pharmacy", message: `Hello ${customer.firstName},\n\nYour Healthfield Pharmacy account is ready. You can now shop, save products, chat with our team and track your orders.` }).catch(console.error);
    if (process.env.NOTIFICATION_EMAIL) await sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: "New Healthfield customer account", message: `${customer.firstName} ${customer.lastName} created a customer account.\nEmail: ${customer.email}\nPhone: ${customer.phone}` }).catch(console.error);
    return json({ token: await createSessionToken(session), session, redirectTo: "/#products" }, { status: 201 });
  }
  if (action === "change-password" && request.method === "POST") {
    const auth = await requireSession(request);
    if ("response" in auth) return auth.response;
    const parsed = z.object({ currentPassword: z.string().min(8).max(128), newPassword: z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Use a strong new password." }, { status: 400 });
    const [user] = await db.select().from(users).where(eq(users.id, auth.session.userId)).limit(1);
    if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) return json({ error: "Current password is incorrect." }, { status: 400 });
    await db.update(users).set({ passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), forcePasswordChange: false }).where(eq(users.id, user.id));
    const session = { ...auth.session, forcePasswordChange: false };
    return json({ token: await createSessionToken(session), session, redirectTo: session.role === "CUSTOMER" ? "/account" : session.role === "STAFF" ? "/staff" : "/admin" });
  }
  return json({ error: "Authentication route not found." }, { status: 404 });
}

export async function handleChats(request: Request) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;
  const db = getDb();
  const requested = Number(new URL(request.url).searchParams.get("conversation") || 0);
  if (request.method === "GET") {
    let conversationId = requested;
    if (auth.session.role === "CUSTOMER") {
      const [conversation] = await db.select().from(chatConversations).where(eq(chatConversations.customerId, auth.session.userId)).limit(1);
      conversationId = conversation?.id || 0;
    } else if (!team.includes(auth.session.role as typeof team[number])) return json({ error: "Not allowed." }, { status: 403 });
    if (!conversationId) return json({ messages: [] });
    const [allowed] = auth.session.role === "CUSTOMER" ? await db.select({ id: chatConversations.id }).from(chatConversations).where(and(eq(chatConversations.id, conversationId), eq(chatConversations.customerId, auth.session.userId))).limit(1) : [{ id: conversationId }];
    if (!allowed) return json({ error: "Not found." }, { status: 404 });
    const messages = await db.select({ id: chatMessages.id, message: chatMessages.message, createdAt: chatMessages.createdAt, senderId: chatMessages.senderId, firstName: users.firstName, role: users.role }).from(chatMessages).innerJoin(users, eq(users.id, chatMessages.senderId)).where(eq(chatMessages.conversationId, conversationId)).orderBy(chatMessages.createdAt);
    await db.update(chatMessages).set({ readAt: new Date() }).where(and(eq(chatMessages.conversationId, conversationId), ne(chatMessages.senderId, auth.session.userId)));
    return json({ conversationId, messages });
  }
  if (request.method === "POST") {
    const parsed = z.object({ message: z.string().trim().min(1).max(2000), conversationId: z.number().int().positive().optional() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Write a message first." }, { status: 400 });
    let conversationId = parsed.data.conversationId;
    if (auth.session.role === "CUSTOMER") {
      const [existing] = await db.select().from(chatConversations).where(eq(chatConversations.customerId, auth.session.userId)).limit(1);
      if (existing) conversationId = existing.id;
      else conversationId = (await db.insert(chatConversations).values({ customerId: auth.session.userId }))[0].insertId;
    } else if (!conversationId || !team.includes(auth.session.role as typeof team[number])) return json({ error: "Conversation required." }, { status: 400 });
    await db.insert(chatMessages).values({ conversationId: conversationId!, senderId: auth.session.userId, message: parsed.data.message });
    await db.update(chatConversations).set({ lastMessageAt: new Date(), status: "OPEN" }).where(eq(chatConversations.id, conversationId!));
    return json({ ok: true, conversationId }, { status: 201 });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handleOrders(request: Request, id?: number) {
  if (request.method === "PATCH" && id) {
    const auth = await requireSession(request, [...team]);
    if ("response" in auth) return auth.response;
    const parsed = z.object({ status:z.enum(orderStatuses),customerName:z.string().trim().max(200).optional(),phone:z.string().trim().max(30).optional(),email:z.string().trim().max(190).nullable().optional(),deliveryAddress:z.string().trim().max(1000).nullable().optional(),deliveryArea:z.string().trim().max(160).nullable().optional() }).safeParse(await body(request));
    if (!Number.isInteger(id) || !parsed.success) return json({ error: "Check the order details and status." }, { status: 400 });
    const db = getDb();
    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return json({ error: "Order not found." }, { status: 404 });
    const editable=!['READY_FOR_DISPATCH','OUT_FOR_DELIVERY','READY_FOR_PICKUP','COMPLETED','CANCELLED'].includes(order.status);
    const {status,...details}=parsed.data;
    await db.update(orders).set({status,...(editable?details:{})}).where(eq(orders.id,id));
    if(order.status===status)return json({ok:true,status});
    const label = status==="READY_FOR_DISPATCH"?"packaged and ready for dispatch":status.replaceAll("_", " ").toLowerCase();
    const notificationEmail=details.email===undefined?order.email:details.email,notificationName=details.customerName||order.customerName;
    if (notificationEmail) void sendEmail({ to: notificationEmail, subject: `Order ${order.orderNumber} update`, message: `Hello ${notificationName},\n\nYour order ${order.orderNumber} is now ${label}.\n\nThank you for choosing Healthfield Pharmacy.` });
    if (process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: `Order ${order.orderNumber} → ${parsed.data.status}`, message: `${order.customerName}'s order ${order.orderNumber} changed from ${order.status} to ${parsed.data.status}.` });
    return json({ok:true,status});
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    fullName: z.string().trim().min(3).max(200), phone: z.string().trim().min(9).max(30), email: z.string().trim().email().optional().or(z.literal("")),
    fulfilmentMethod: z.enum(["DELIVERY", "PICKUP"]), deliveryAddress: z.string().trim().max(1000).optional(), deliveryArea: z.string().trim().max(160).optional(),
    deliveryLatitude: z.number().min(-90).max(90).optional(), deliveryLongitude: z.number().min(-180).max(180).optional(),
    checkoutToken: z.string().uuid(), items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).min(1),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid order." }, { status: 400 });
  if (parsed.data.fulfilmentMethod === "DELIVERY" && !parsed.data.deliveryAddress) return json({ error: "Delivery address is required." }, { status: 400 });
  const db = getDb();
  const [duplicate] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, total: orders.total }).from(orders).where(eq(orders.checkoutToken, parsed.data.checkoutToken)).limit(1);
  if (duplicate) return json({ ok: true, id: duplicate.id, orderNumber: duplicate.orderNumber, total: Number(duplicate.total), duplicate: true });
  const catalog = await db.select().from(products).where(inArray(products.id, parsed.data.items.map((item) => item.productId)));
  if (catalog.length !== new Set(parsed.data.items.map((item) => item.productId)).size) return json({ error: "One or more products are unavailable." }, { status: 409 });
  const lines = parsed.data.items.map((item) => { const product = catalog.find((entry) => entry.id === item.productId)!; const price = Number(product.discountPrice ?? product.price); return { ...item, product, price, total: price * item.quantity }; });
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const deliveryFee = parsed.data.fulfilmentMethod === "DELIVERY" ? 250 : 0;
  const session = await requestSession(request);
  const orderNumber = `HF-${Date.now().toString().slice(-8)}`;
  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(orders).values({ orderNumber, checkoutToken: parsed.data.checkoutToken, customerId: session?.role === "CUSTOMER" ? session.userId : null, customerName: parsed.data.fullName, phone: parsed.data.phone, email: parsed.data.email || null, fulfilmentMethod: parsed.data.fulfilmentMethod, deliveryAddress: parsed.data.deliveryAddress || null, deliveryArea: parsed.data.deliveryArea || null, deliveryLatitude: parsed.data.deliveryLatitude?.toString() || null, deliveryLongitude: parsed.data.deliveryLongitude?.toString() || null, subtotal: subtotal.toString(), deliveryFee: deliveryFee.toString(), discount: "0", total: (subtotal + deliveryFee).toString() });
    await tx.insert(orderItems).values(lines.map((line) => ({ orderId: created.insertId, productId: line.product.id, productName: line.product.name, quantity: line.quantity, unitPrice: line.price.toString(), lineTotal: line.total.toString() })));
    return created;
  });
  if (parsed.data.email) void sendEmail({ to: parsed.data.email, subject: `Order ${orderNumber} received`, message: `Hello ${parsed.data.fullName},\n\nWe received order ${orderNumber}. Total: KES ${(subtotal + deliveryFee).toLocaleString()}.\n\nWe will update you as your order progresses.`, html:orderEmailHtml({name:parsed.data.fullName,orderNumber,items:lines.map(line=>({productName:line.product.name,quantity:line.quantity,lineTotal:line.total.toString()})),subtotal,deliveryFee,total:subtotal+deliveryFee,status:"NEW"}) });
  if (process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: `New order ${orderNumber}`, message: `${parsed.data.fullName} placed order ${orderNumber}.\nPhone: ${parsed.data.phone}\nEmail: ${parsed.data.email || "not provided"}\nFulfilment: ${parsed.data.fulfilmentMethod}\nTotal: KES ${(subtotal + deliveryFee).toLocaleString()}.` });
  return json({ ok: true, id: result.insertId, orderNumber, total: subtotal + deliveryFee }, { status: 201 });
}

const productSchema = z.object({
  categoryId: z.coerce.number().int().positive(), name: z.string().trim().min(2).max(220), brand: z.string().trim().max(150).optional().default(""),
  shortDescription: z.string().trim().max(500).optional().default(""), imageUrl: z.string().trim().max(500).optional().default(""),
  description: z.string().trim().max(1000).optional().default(""),
  price: z.coerce.number().nonnegative(), discountPrice: z.coerce.number().nonnegative().nullable().optional(), packSize: z.string().trim().max(100).optional().default(""),
  prescriptionRequired: z.coerce.boolean().default(false), isFeatured: z.coerce.boolean().default(false), conditionIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});

export async function handleProducts(request: Request, id?: number) {
  const db = getDb();
  if (request.method === "GET" && !id) {
    return json({ products: (await db.select().from(products).where(eq(products.isActive, true)).orderBy(desc(products.isFeatured), desc(products.createdAt))).map((product) => ({ ...product, imageUrl: publicImageUrl(product.imageUrl) })) }, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method === "POST" && !id) {
    const parsed = productSchema.safeParse(await body(request));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid product." }, { status: 400 });
    const values = parsed.data;
    const suffix = Date.now().toString(36);
    const baseSlug = values.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const created = await db.transaction(async (tx) => {
      const [record] = await tx.insert(products).values({ categoryId: values.categoryId, name: values.name, slug: `${baseSlug}-${suffix}`, sku: `HF-${suffix.toUpperCase()}`, brand: values.brand || null, shortDescription: values.shortDescription || null, description: values.description || null, imageUrl: normalizeStoredImageUrl(values.imageUrl), discountPrice: values.discountPrice?.toString() ?? null, price: values.price.toString(), packSize: values.packSize || null, prescriptionRequired: values.prescriptionRequired, isFeatured: values.isFeatured, isActive: true });
      if (values.conditionIds.length) await tx.insert(productHealthConditions).values(values.conditionIds.map((conditionId) => ({ productId: record.insertId, conditionId })));
      const stores = await tx.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true));
      if (stores.length) await tx.insert(branchInventory).values(stores.map((store) => ({ branchId: store.id, productId: record.insertId, quantityAvailable: 0, quantityReserved: 0, reorderLevel: 5, updatedBy: auth.session.userId })));
      return record;
    });
    return json({ ok: true, id: created.insertId }, { status: 201 });
  }
  if (!id || !Number.isInteger(id)) return json({ error: "Invalid product." }, { status: 400 });
  if (request.method === "DELETE") {
    await db.transaction(async (tx) => {
      await tx.delete(productHealthConditions).where(eq(productHealthConditions.productId, id));
      await tx.delete(productReviews).where(eq(productReviews.productId, id));
      await tx.delete(branchInventory).where(eq(branchInventory.productId, id));
      await tx.delete(products).where(eq(products.id, id));
    });
    return json({ ok: true });
  }
  if (request.method === "PATCH") {
    const parsed = z.object({ name: z.string().trim().min(2).max(220).optional(), categoryId: z.coerce.number().int().positive().optional(), brand: z.string().trim().max(150).nullable().optional(), shortDescription: z.string().trim().max(500).nullable().optional(), description: z.string().trim().max(1000).nullable().optional(), packSize: z.string().trim().max(100).nullable().optional(), price: z.coerce.number().nonnegative().optional(), discountPrice: z.coerce.number().nonnegative().nullable().optional(), imageUrl: z.string().trim().max(500).nullable().optional(), isFeatured: z.boolean().optional(), isActive: z.boolean().optional(), conditionIds: z.array(z.coerce.number().int().positive()).optional() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Invalid product update." }, { status: 400 });
    const { conditionIds, ...update } = parsed.data;
    const normalized = { ...update, imageUrl: parsed.data.imageUrl === undefined ? undefined : normalizeStoredImageUrl(parsed.data.imageUrl) };
    await db.transaction(async (tx) => {
      await tx.update(products).set({ ...normalized, price: parsed.data.price?.toString(), discountPrice: parsed.data.discountPrice === null ? null : parsed.data.discountPrice?.toString() }).where(eq(products.id, id));
      if (conditionIds) { await tx.delete(productHealthConditions).where(eq(productHealthConditions.productId, id)); if (conditionIds.length) await tx.insert(productHealthConditions).values(conditionIds.map((conditionId) => ({ productId: id, conditionId }))); }
    });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handleTaxonomy(request: Request, kind: "categories" | "conditions", id?: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method === "DELETE" && id) { if(kind==="categories")await getDb().update(categories).set({isActive:false}).where(eq(categories.id,id));else await getDb().update(healthConditions).set({isActive:false}).where(eq(healthConditions.id,id)); return json({ok:true}); }
  if (request.method === "PATCH" && id) { const parsed=z.object({name:z.string().trim().min(2).max(150),description:z.string().trim().max(500).optional().default("")}).safeParse(await body(request));if(!parsed.success)return json({error:"Enter a valid name."},{status:400});if(kind==="categories")await getDb().update(categories).set({name:parsed.data.name}).where(eq(categories.id,id));else await getDb().update(healthConditions).set({name:parsed.data.name,description:parsed.data.description||null}).where(eq(healthConditions.id,id));return json({ok:true}); }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({ name: z.string().trim().min(2).max(150), description: z.string().trim().max(500).optional().default("") }).safeParse(await body(request));
  if (!parsed.success) return json({ error: "Enter a valid name." }, { status: 400 });
  const slug = `${parsed.data.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
  const [created] = kind === "categories"
    ? await getDb().insert(categories).values({ name: parsed.data.name, slug, isActive: true })
    : await getDb().insert(healthConditions).values({ name: parsed.data.name, slug, description: parsed.data.description || null, isActive: true });
  return json({ ok: true, id: created.insertId, name: parsed.data.name }, { status: 201 });
}

function storageRoot() {
  return path.resolve(process.env.STORAGE_ROOT || path.join(process.cwd(), "storage"));
}

function normalizeStoredImageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      const url = new URL(value);
      if (url.pathname.startsWith("/uploads/products/")) return url.pathname;
    }
  } catch { /* keep original */ }
  return value.startsWith("/uploads/products/") ? value : value;
}

export async function handleProductImage(request: Request) {
  const auth = await requireSession(request, [...admins], true);
  if ("response" in auth) return auth.response;
  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return json({ error: "Choose a product image." }, { status: 400 });
  const types = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/gif", "gif"], ["image/avif", "avif"], ["image/bmp", "bmp"], ["image/tiff", "tiff"]]);
  const extension = types.get(image.type.toLowerCase());
  if (!extension) return json({ error: "Use JPEG, PNG, WebP, GIF, AVIF, BMP or TIFF." }, { status: 415 });
  if (image.size <= 0 || image.size > 2 * 1024 * 1024) return json({ error: "Product images must be 2 MB or smaller." }, { status: 413 });
  const filename = `${randomUUID()}.${extension}`;
  const directory = path.join(storageRoot(), "uploads", "products");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), Buffer.from(await image.arrayBuffer()), { flag: "wx" });
  return json({ imageUrl: publicImageUrl(`/uploads/products/${filename}`) }, { status: 201 });
}

export async function serveProductImage(filename: string) {
  if (!/^[a-zA-Z0-9-]+\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(filename)) return json({ error: "Not found." }, { status: 404 });
  try {
    const buffer = await readFile(path.join(storageRoot(), "uploads", "products", filename));
    const extension = path.extname(filename).toLowerCase();
    const types: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff" };
    return new Response(buffer, { headers: { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch { return json({ error: "Image not found." }, { status: 404 }); }
}

export async function handlePrescriptions(request: Request, downloadId?: number) {
  if (downloadId) {
    const auth = await requireSession(request, [...team]);
    if ("response" in auth) return auth.response;
    const db=getDb();
    if(request.method==="PATCH"){
      const parsed=z.object({status:z.enum(["RECEIVED","UNDER_REVIEW","APPROVED","MORE_INFORMATION_REQUIRED","DECLINED"]),pharmacistNotes:z.string().trim().max(2000).optional().default("")}).safeParse(await body(request));
      if(!parsed.success)return json({error:"Choose a valid prescription status."},{status:400});
      const [record]=await db.select({id:prescriptions.id,email:users.email,firstName:users.firstName}).from(prescriptions).leftJoin(users,eq(users.id,prescriptions.customerId)).where(eq(prescriptions.id,downloadId)).limit(1);
      if(!record)return json({error:"Prescription not found."},{status:404});
      await db.update(prescriptions).set({status:parsed.data.status,pharmacistNotes:parsed.data.pharmacistNotes||null,reviewedBy:auth.session.userId,reviewedAt:new Date()}).where(eq(prescriptions.id,downloadId));
      if(record.email)void sendEmail({to:record.email,subject:"Prescription review update",message:`Hello ${record.firstName||"customer"},\n\nYour prescription status is now ${parsed.data.status.replaceAll("_"," ").toLowerCase()}.${parsed.data.pharmacistNotes?`\n\nPharmacist note: ${parsed.data.pharmacistNotes}`:""}\n\nSign in to your Healthfield account to track progress.`});
      return json({ok:true,status:parsed.data.status});
    }
    const [record] = await db.select().from(prescriptions).where(eq(prescriptions.id, downloadId)).limit(1);
    if (!record) return json({ error: "Prescription not found." }, { status: 404 });
    try {
      const buffer = await readFile(path.join(storageRoot(), "prescriptions", path.basename(record.storageKey)));
      return new Response(buffer, { headers: { "Content-Type": record.mimeType, "Content-Disposition": `inline; filename="${safeFilename(record.originalFilename)}"`, "Cache-Control": "private, no-store" } });
    } catch { return json({ error: "Prescription file is missing." }, { status: 404 }); }
  }
  const auth = await requireSession(request, undefined, true);
  if ("response" in auth) return auth.response;
  const form = await request.formData();
  const file = form.get("prescription");
  if (!(file instanceof File)) return json({ error: "Choose a prescription file." }, { status: 400 });
  const allowed = new Map([["application/pdf", ".pdf"], ["image/png", ".png"], ["image/jpeg", ".jpg"]]);
  const extension = allowed.get(file.type);
  if (!extension) return json({ error: "Only PDF, PNG, JPG and JPEG files are supported." }, { status: 415 });
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) return json({ error: "The file must be 2 MB or smaller." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const valid = file.type === "application/pdf" ? bytes.slice(0, 4).toString() === "37,80,68,70" : file.type === "image/png" ? bytes.slice(0, 8).toString() === "137,80,78,71,13,10,26,10" : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!valid) return json({ error: "The file content does not match its format." }, { status: 400 });
  const directory = path.join(storageRoot(), "prescriptions");
  await mkdir(directory, { recursive: true });
  const storedName = `${randomUUID()}${extension}`;
  await writeFile(path.join(directory, storedName), bytes, { flag: "wx" });
  const [created] = await getDb().insert(prescriptions).values({ customerId: auth.session.userId, storageKey: storedName, originalFilename: safeFilename(file.name), mimeType: file.type, sizeBytes: file.size, status: "RECEIVED" });
  void sendEmail({to:auth.session.email,subject:"Prescription received",message:`Hello ${auth.session.firstName},\n\nWe received your prescription and it is awaiting pharmacist review. Track its progress from your Healthfield account.`});
  if(process.env.NOTIFICATION_EMAIL)void sendEmail({to:process.env.NOTIFICATION_EMAIL,subject:"New prescription awaiting review",message:`A new prescription upload is awaiting pharmacist review. Reference: ${created.insertId}.`});
  return json({ ok: true, id: created.insertId }, { status: 201 });
}

export async function handleInventory(request: Request, id: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const parsed = z.object({ quantityAvailable: z.number().int().nonnegative(), quantityReserved: z.number().int().nonnegative(), reorderLevel: z.number().int().nonnegative() }).safeParse(await body(request));
  if (!Number.isInteger(id) || !parsed.success) return json({ error: "Enter valid non-negative stock quantities." }, { status: 400 });
  await getDb().update(branchInventory).set({ ...parsed.data, updatedBy: auth.session.userId }).where(eq(branchInventory.id, id));
  return json({ ok: true });
}

export async function handleSettings(request: Request) {
  const db = getDb();
  if (request.method === "GET") {
    const [settings] = await db.select({ pharmacyName: siteSettings.pharmacyName, phone: siteSettings.phone, whatsapp: siteSettings.whatsapp, supportEmail: siteSettings.supportEmail, address: siteSettings.address, openingHours: siteSettings.openingHours, deliveryMessage: siteSettings.deliveryMessage, freeDeliveryThreshold: siteSettings.freeDeliveryThreshold }).from(siteSettings).limit(1);
    return json({ settings: settings ?? null });
  }
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const parsed = z.object({
    pharmacyName: z.string().trim().min(2).max(150), phone: z.string().trim().max(30), whatsapp: z.string().trim().max(30), supportEmail: z.string().trim().email().or(z.literal("")),
    address: z.string().trim().max(1000), openingHours: z.string().trim().max(255), deliveryMessage: z.string().trim().min(2).max(255), freeDeliveryThreshold: z.coerce.number().nonnegative().optional(),
    bulkSmsApiUrl: z.string().trim().url().or(z.literal("")), bulkSmsApiKey: z.string().trim().max(500), bulkSmsSenderId: z.string().trim().max(50),
    facebookUrl: z.string().trim().url().or(z.literal("")), instagramUrl: z.string().trim().url().or(z.literal("")), xUrl: z.string().trim().url().or(z.literal("")), tiktokUrl: z.string().trim().url().or(z.literal("")),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." }, { status: 400 });
  const data = parsed.data;
  const values = { ...data, phone: data.phone || null, whatsapp: data.whatsapp || null, supportEmail: data.supportEmail || null, address: data.address || null, openingHours: data.openingHours || null, freeDeliveryThreshold: data.freeDeliveryThreshold?.toString() ?? null, bulkSmsApiUrl: data.bulkSmsApiUrl || null, bulkSmsApiKey: data.bulkSmsApiKey || null, bulkSmsSenderId: data.bulkSmsSenderId || null, facebookUrl: data.facebookUrl || null, instagramUrl: data.instagramUrl || null, xUrl: data.xUrl || null, tiktokUrl: data.tiktokUrl || null, updatedBy: auth.session.userId };
  const [current] = await db.select({ id: siteSettings.id }).from(siteSettings).limit(1);
  if (current) await db.update(siteSettings).set(values).where(eq(siteSettings.id, current.id)); else await db.insert(siteSettings).values(values);
  return json({ ok: true });
}

export async function handleStaff(request: Request, id?: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const db = getDb();
  if (request.method === "GET" && !id) return json({ staff: await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, role: users.role, homeBranchId: users.homeBranchId, isActive: users.isActive }).from(users).where(ne(users.role, "CUSTOMER")).orderBy(desc(users.createdAt)) });
  if (request.method === "POST" && !id) {
    const parsed = z.object({ firstName: z.string().trim().min(2).max(100), lastName: z.string().trim().min(2).max(100), email: z.string().trim().email(), phone: z.string().trim().max(30).optional().default(""), role: z.enum(["STAFF", "ADMIN"]), homeBranchId: z.coerce.number().int().positive().nullable().optional(), password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Enter valid staff details and a strong password." }, { status: 400 });
    try { const { password, ...values } = parsed.data; const [created] = await db.insert(users).values({ ...values, phone: values.phone || null, passwordHash: await hash(password, 12), isActive: true, forcePasswordChange: true }); return json({ id: created.insertId }, { status: 201 }); } catch { return json({ error: "That email address or phone is already registered." }, { status: 409 }); }
  }
  if (request.method === "PATCH" && id) {
    const parsed = z.object({ firstName: z.string().trim().min(2).max(100).optional(), lastName: z.string().trim().min(2).max(100).optional(), phone: z.string().trim().max(30).optional(), role: z.enum(["STAFF", "ADMIN"]).optional(), homeBranchId: z.coerce.number().int().positive().nullable().optional(), isActive: z.boolean().optional(), password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).optional() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Check the staff details." }, { status: 400 });
    const { password, ...values } = parsed.data;
    await db.update(users).set({ ...values, phone: values.phone === "" ? null : values.phone, ...(password ? { passwordHash: await hash(password, 12), forcePasswordChange: true } : {}) }).where(eq(users.id, id));
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handleStores(request: Request, id?: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const db = getDb();
  if (request.method === "GET" && !id) return json({ stores: await db.select().from(branches).orderBy(desc(branches.createdAt)) });
  const schema = z.object({ name: z.string().trim().min(2).max(150), code: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase()), phone: z.string().trim().min(7).max(30), email: z.string().trim().email().or(z.literal("")), address: z.string().trim().min(4) });
  if (request.method === "POST" && !id) {
    const parsed = schema.safeParse(await body(request));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the store details." }, { status: 400 });
    try {
      const created = await db.transaction(async (tx) => { const [store] = await tx.insert(branches).values({ ...parsed.data, email: parsed.data.email || null, isActive: true }); const catalogue = await tx.select({ id: products.id }).from(products); if (catalogue.length) await tx.insert(branchInventory).values(catalogue.map((product) => ({ branchId: store.insertId, productId: product.id, quantityAvailable: 0, quantityReserved: 0, reorderLevel: 5, updatedBy: auth.session.userId }))); return store; });
      return json({ id: created.insertId }, { status: 201 });
    } catch { return json({ error: "That store code is already in use." }, { status: 409 }); }
  }
  if (request.method === "PATCH" && id) {
    const parsed = schema.partial().extend({ isActive: z.boolean().optional() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the store details." }, { status: 400 });
    await db.update(branches).set({ ...parsed.data, email: parsed.data.email === "" ? null : parsed.data.email }).where(eq(branches.id, id));
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handleCampaigns(request: Request) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const parsed = z.object({ name:z.string().trim().min(2).max(180),channel:z.enum(["EMAIL","SMS","EMAIL_AND_SMS"]),subject:z.string().trim().max(220).optional().default(""),message:z.string().trim().min(2).max(3000),audience:z.enum(["MARKETING_CUSTOMERS","ORDER_CUSTOMERS","ALL_CONTACTS"]).default("MARKETING_CUSTOMERS"),lookbackDays:z.coerce.number().int().min(0).max(3650).default(0) }).safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Invalid campaign." }, { status: 400 });
  const db = getDb();
  const [settings] = await db.select().from(siteSettings).limit(1);
  const since=parsed.data.lookbackDays?new Date(Date.now()-parsed.data.lookbackDays*86400000):null;
  const [registered,orderContacts]=await Promise.all([
    parsed.data.audience!=="ORDER_CUSTOMERS"?db.select({email:users.email,phone:users.phone}).from(users).where(and(eq(users.role,"CUSTOMER"),eq(users.isActive,true),eq(users.marketingConsent,true),...(since?[gte(users.createdAt,since)]:[]))):Promise.resolve([]),
    parsed.data.audience!=="MARKETING_CUSTOMERS"?db.select({email:orders.email,phone:orders.phone}).from(orders).where(since?gte(orders.createdAt,since):undefined):Promise.resolve([]),
  ]);
  const contacts=new Map<string,{email:string|null;phone:string|null}>();
  for(const contact of [...registered,...orderContacts]){const email=contact.email?.trim().toLowerCase()||null,phone=contact.phone?.trim()||null,key=email?`e:${email}`:phone?`p:${phone}`:"";if(key&&!contacts.has(key))contacts.set(key,{email,phone})}
  const customers=[...contacts.values()];
  const wantsEmail = parsed.data.channel !== "SMS", wantsSms = parsed.data.channel !== "EMAIL";
  if(wantsEmail&&(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD))return json({error:"Configure the cPanel SMTP mailbox in api-service/.env first."},{status:400});
  if (wantsSms && (!settings?.bulkSmsApiUrl || !settings.bulkSmsApiKey || !settings.bulkSmsSenderId)) return json({ error: "Configure the bulk SMS API first." }, { status: 400 });
  const {audience:_audience,lookbackDays:_lookbackDays,...campaignData}=parsed.data;
  const [created] = await db.insert(campaigns).values({ ...campaignData, subject: parsed.data.subject || null, status: "SENDING", recipientCount: customers.length, createdBy: auth.session.userId });
  let successCount = 0, failureCount = 0;
  try {
    if(wantsEmail){const recipients=customers.map(customer=>customer.email).filter((email):email is string=>Boolean(email)),result=await sendBulkEmail({recipients,subject:parsed.data.subject||parsed.data.name,message:parsed.data.message});successCount+=result.successCount;failureCount+=result.failureCount}
    if (wantsSms) { const recipients = customers.map((customer) => customer.phone).filter((phone): phone is string => Boolean(phone)); const response = await fetch(settings!.bulkSmsApiUrl!, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings!.bulkSmsApiKey}` }, body: JSON.stringify({ recipients, senderId: settings!.bulkSmsSenderId, message: parsed.data.message }) }); response.ok ? successCount += recipients.length : failureCount += recipients.length; }
    await db.update(campaigns).set({ status: failureCount ? "FAILED" : "SENT", successCount, failureCount, sentAt: new Date() }).where(eq(campaigns.id, created.insertId));
  } catch { failureCount = customers.length; await db.update(campaigns).set({ status: "FAILED", successCount, failureCount }).where(eq(campaigns.id, created.insertId)); }
  return json({ ok: failureCount === 0, id: created.insertId, recipientCount: customers.length, successCount, failureCount }, { status: failureCount ? 502 : 201 });
}
