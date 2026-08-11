import {
  boolean,
  bigint,
  decimal,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
};

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 190 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"]).notNull(),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
  forcePasswordChange: boolean("force_password_change").default(false).notNull(),
  homeBranchId: int("home_branch_id"),
  lastLoginAt: timestamp("last_login_at"),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  marketingConsent: boolean("marketing_consent").default(false).notNull(),
  marketingConsentAt: timestamp("marketing_consent_at"),
  emailVerifiedAt: timestamp("email_verified_at"),
  deletedAt: timestamp("deleted_at").default(sql`null`),
  ...timestamps,
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  uniqueIndex("users_phone_unique").on(table.phone),
]);

export const branches = mysqlTable("branches", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 150 }).notNull(),
  code: varchar("code", { length: 30 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  email: varchar("email", { length: 190 }),
  address: text("address").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  openingHours: json("opening_hours").$type<Record<string, string>>(),
  deliveryAreas: json("delivery_areas").$type<string[]>(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("branches_code_unique").on(table.code)]);

export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  parentId: int("parent_id"),
  name: varchar("name", { length: 150 }).notNull(),
  slug: varchar("slug", { length: 170 }).notNull(),
  imageUrl: varchar("image_url", { length: 500 }),
  displayOrder: int("display_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  // At most six categories may be featured in the storefront "Shop by category" list.
  featuredOnStorefront: boolean("featured_on_storefront").default(false).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("categories_slug_unique").on(table.slug)]);

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  categoryId: int("category_id").notNull().references(() => categories.id),
  name: varchar("name", { length: 220 }).notNull(),
  slug: varchar("slug", { length: 240 }).notNull(),
  sku: varchar("sku", { length: 80 }).notNull(),
  barcode: varchar("barcode", { length: 100 }),
  brand: varchar("brand", { length: 150 }),
  shortDescription: varchar("short_description", { length: 500 }),
  imageUrl: varchar("image_url", { length: 500 }),
  description: text("description"),
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
  discountPrice: decimal("discount_price", { precision: 12, scale: 2 }),
  packSize: varchar("pack_size", { length: 100 }),
  productForm: varchar("product_form", { length: 80 }),
  strength: varchar("strength", { length: 80 }),
  activeIngredient: varchar("active_ingredient", { length: 190 }),
  prescriptionRequired: boolean("prescription_required").default(false).notNull(),
  isFeatured: boolean("is_featured").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  usageInformation: text("usage_information"),
  warnings: text("warnings"),
  storageInformation: text("storage_information"),
  ...timestamps,
}, (table) => [
  uniqueIndex("products_slug_unique").on(table.slug),
  uniqueIndex("products_sku_unique").on(table.sku),
  index("products_search_idx").on(table.name, table.brand),
]);

export const branchInventory = mysqlTable("branch_inventory", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id").notNull().references(() => branches.id),
  productId: int("product_id").notNull().references(() => products.id),
  quantityAvailable: int("quantity_available").default(0).notNull(),
  quantityReserved: int("quantity_reserved").default(0).notNull(),
  reorderLevel: int("reorder_level").default(5).notNull(),
  updatedBy: int("updated_by").references(() => users.id),
  ...timestamps,
}, (table) => [
  uniqueIndex("branch_product_unique").on(table.branchId, table.productId),
  index("inventory_availability_idx").on(table.productId, table.quantityAvailable),
]);

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  orderNumber: varchar("order_number", { length: 40 }).notNull(),
  checkoutToken: varchar("checkout_token", { length: 64 }),
  customerId: int("customer_id").references(() => users.id),
  customerName: varchar("customer_name", { length: 200 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  email: varchar("email", { length: 190 }),
  fulfilmentMethod: mysqlEnum("fulfilment_method", ["DELIVERY", "PICKUP"]).notNull(),
  deliveryAddress: text("delivery_address"),
  deliveryArea: varchar("delivery_area", { length: 160 }),
  deliveryLatitude: decimal("delivery_latitude", { precision: 10, scale: 7 }),
  deliveryLongitude: decimal("delivery_longitude", { precision: 10, scale: 7 }),
  status: mysqlEnum("status", ["NEW", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"]).default("NEW").notNull(),
  paymentStatus: mysqlEnum("payment_status", ["PENDING", "PAID", "FAILED", "REFUNDED"]).default("PENDING").notNull(),
  paymentMethod: varchar("payment_method", { length: 20 }).default("MPESA").notNull(),
  paymentReference: varchar("payment_reference", { length: 100 }),
  amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }).default("0").notNull(),
  prescriptionStatus: mysqlEnum("prescription_status", ["NOT_REQUIRED", "RECEIVED", "UNDER_REVIEW", "APPROVED", "MORE_INFORMATION_REQUIRED", "DECLINED"]).default("NOT_REQUIRED").notNull(),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  deliveryFee: decimal("delivery_fee", { precision: 12, scale: 2 }).default("0").notNull(),
  discount: decimal("discount", { precision: 12, scale: 2 }).default("0").notNull(),
  total: decimal("total", { precision: 12, scale: 2 }).notNull(),
  suggestedBranchId: int("suggested_branch_id").references(() => branches.id),
  ...timestamps,
}, (table) => [
  uniqueIndex("orders_number_unique").on(table.orderNumber),
  uniqueIndex("orders_checkout_token_unique").on(table.checkoutToken),
  index("orders_work_queue_idx").on(table.status, table.createdAt),
]);

export const paymentTransactions = mysqlTable("payment_transactions", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id").notNull().references(() => orders.id),
  method: mysqlEnum("method", ["MPESA_EXPRESS", "MANUAL_MPESA", "CASH"]).notNull(),
  channel: mysqlEnum("channel", ["ONLINE", "POS"]).notNull(),
  status: mysqlEnum("status", ["INITIATED", "PENDING", "REQUIRES_REVIEW", "PAID", "FAILED", "CANCELLED", "REFUNDED"]).default("INITIATED").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  merchantRequestId: varchar("merchant_request_id", { length: 120 }),
  checkoutRequestId: varchar("checkout_request_id", { length: 120 }),
  receiptNumber: varchar("receipt_number", { length: 100 }),
  manualMessage: text("manual_message"),
  resultCode: varchar("result_code", { length: 40 }),
  resultDescription: varchar("result_description", { length: 500 }),
  providerPayload: json("provider_payload").$type<Record<string, unknown>>(),
  verifiedAt: timestamp("verified_at"),
  reviewedBy: int("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  ...timestamps,
}, (table) => [
  index("payment_order_idx").on(table.orderId, table.createdAt),
  uniqueIndex("payment_checkout_request_unique").on(table.checkoutRequestId),
  uniqueIndex("payment_receipt_unique").on(table.receiptNumber),
  index("payment_review_queue_idx").on(table.status, table.createdAt),
]);

export const mpesaIncomingPayments = mysqlTable("mpesa_incoming_payments", {
  id: int("id").autoincrement().primaryKey(),
  receiptNumber: varchar("receipt_number", { length: 100 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  accountReference: varchar("account_reference", { length: 120 }),
  transactionTime: varchar("transaction_time", { length: 30 }),
  providerPayload: json("provider_payload").$type<Record<string, unknown>>(),
  matchedTransactionId: int("matched_transaction_id"),
  ...timestamps,
}, (table) => [
  uniqueIndex("mpesa_incoming_receipt_unique").on(table.receiptNumber),
  index("mpesa_incoming_match_idx").on(table.matchedTransactionId, table.createdAt),
  foreignKey({ columns: [table.matchedTransactionId], foreignColumns: [paymentTransactions.id], name: "mpesa_incoming_transaction_fk" }),
]);

export const mpesaStkCallbacks = mysqlTable("mpesa_stk_callbacks", {
  id: int("id").autoincrement().primaryKey(),
  checkoutRequestId: varchar("checkout_request_id", { length: 120 }).notNull(),
  providerPayload: json("provider_payload").$type<Record<string, unknown>>().notNull(),
  processedTransactionId: int("processed_transaction_id"),
  ...timestamps,
}, (table) => [
  uniqueIndex("mpesa_stk_callback_checkout_unique").on(table.checkoutRequestId),
  index("mpesa_stk_callback_processed_idx").on(table.processedTransactionId, table.createdAt),
  foreignKey({ columns: [table.processedTransactionId], foreignColumns: [paymentTransactions.id], name: "mpesa_stk_transaction_fk" }),
]);

export const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id").notNull().references(() => orders.id),
  productId: int("product_id").references(() => products.id, { onDelete: "set null" }),
  productName: varchar("product_name", { length: 220 }).notNull(),
  quantity: int("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
  lineTotal: decimal("line_total", { precision: 12, scale: 2 }).notNull(),
  // Bundle members keep one row each so stock still moves per product, but share an
  // offer id and title so the customer sees a single priced line.
  offerId: int("offer_id"),
  offerTitle: varchar("offer_title", { length: 180 }),
  ...timestamps,
}, (table) => [index("order_items_order_idx").on(table.orderId)]);

export const orderItemFulfilments = mysqlTable("order_item_fulfilments", {
  id: int("id").autoincrement().primaryKey(),
  orderItemId: int("order_item_id").notNull().references(() => orderItems.id),
  branchId: int("branch_id").notNull().references(() => branches.id),
  handledBy: int("handled_by").references(() => users.id),
  quantityReserved: int("quantity_reserved").default(0).notNull(),
  quantityPacked: int("quantity_packed").default(0).notNull(),
  status: mysqlEnum("status", ["UNASSIGNED", "RESERVED", "PARTIALLY_RESERVED", "PACKED", "READY", "UNAVAILABLE", "REPLACED"]).default("UNASSIGNED").notNull(),
  notes: text("notes"),
  ...timestamps,
}, (table) => [index("fulfilment_item_idx").on(table.orderItemId)]);

export const prescriptions = mysqlTable("prescriptions", {
  id: int("id").autoincrement().primaryKey(),
  customerId: int("customer_id").references(() => users.id),
  orderId: int("order_id").references(() => orders.id),
  senderName: varchar("sender_name", { length: 200 }),
  storageKey: varchar("storage_key", { length: 500 }).notNull(),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: int("size_bytes").notNull(),
  status: mysqlEnum("status", ["RECEIVED", "UNDER_REVIEW", "APPROVED", "MORE_INFORMATION_REQUIRED", "DECLINED"]).default("RECEIVED").notNull(),
  pharmacistNotes: text("pharmacist_notes"),
  reviewedBy: int("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  ...timestamps,
}, (table) => [index("prescriptions_review_queue_idx").on(table.status, table.createdAt)]);

export const activityLogs = mysqlTable("activity_logs", {
  id: int("id").autoincrement().primaryKey(),
  actorId: int("actor_id").references(() => users.id),
  action: varchar("action", { length: 120 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: varchar("entity_id", { length: 80 }),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [index("activity_entity_idx").on(table.entityType, table.entityId)]);

export const siteSettings = mysqlTable("site_settings", {
  id: int("id").autoincrement().primaryKey(),
  pharmacyName: varchar("pharmacy_name", { length: 150 }).default("Healthfield Pharmacy").notNull(),
  phone: varchar("phone", { length: 30 }),
  whatsapp: varchar("whatsapp", { length: 30 }),
  supportEmail: varchar("support_email", { length: 190 }),
  address: text("address"),
  openingHours: varchar("opening_hours", { length: 255 }),
  deliveryMessage: varchar("delivery_message", { length: 255 }).default("Fast Delivery Across Kenya").notNull(),
  freeDeliveryThreshold: decimal("free_delivery_threshold", { precision: 12, scale: 2 }),
  bulkSmsApiUrl: varchar("bulk_sms_api_url", { length: 500 }),
  bulkSmsApiKey: varchar("bulk_sms_api_key", { length: 500 }),
  bulkSmsSenderId: varchar("bulk_sms_sender_id", { length: 50 }),
  emailApiUrl: varchar("email_api_url", { length: 500 }),
  emailApiKey: varchar("email_api_key", { length: 500 }),
  campaignFromEmail: varchar("campaign_from_email", { length: 190 }),
  facebookUrl: varchar("facebook_url", { length: 500 }),
  instagramUrl: varchar("instagram_url", { length: 500 }),
  xUrl: varchar("x_url", { length: 500 }),
  tiktokUrl: varchar("tiktok_url", { length: 500 }),
  licenceTitle: varchar("licence_title", { length: 190 }),
  licenceNumber: varchar("licence_number", { length: 120 }),
  licenceImageUrl: varchar("licence_image_url", { length: 500 }),
  requireTeamTwoFactor: boolean("require_team_two_factor").default(false).notNull(),
  onlineMpesaEnabled: boolean("online_mpesa_enabled").default(true).notNull(),
  onlineManualEnabled: boolean("online_manual_enabled").default(true).notNull(),
  posCashEnabled: boolean("pos_cash_enabled").default(true).notNull(),
  posMpesaEnabled: boolean("pos_mpesa_enabled").default(true).notNull(),
  posManualEnabled: boolean("pos_manual_enabled").default(true).notNull(),
  mpesaTillNumber: varchar("mpesa_till_number", { length: 30 }),
  mpesaAccountName: varchar("mpesa_account_name", { length: 150 }),
  updatedBy: int("updated_by").references(() => users.id),
  ...timestamps,
});

export const twoFactorChallenges = mysqlTable("two_factor_challenges", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  attemptCount: int("attempt_count").default(0).notNull(),
  resendCount: int("resend_count").default(0).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  expiresAtMs: bigint("expires_at_ms", { mode: "number" }),
  challengeEndsAtMs: bigint("challenge_ends_at_ms", { mode: "number" }).notNull(),
  lastSentAtMs: bigint("last_sent_at_ms", { mode: "number" }),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("two_factor_challenges_token_unique").on(table.tokenHash),
  index("two_factor_challenges_user_idx").on(table.userId),
]);

export const authSessions = mysqlTable("auth_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull().references(() => users.id),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
  revokedAt: timestamp("revoked_at").default(sql`null`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("auth_sessions_token_unique").on(table.tokenHash),
  index("auth_sessions_user_idx").on(table.userId),
  index("auth_sessions_expiry_idx").on(table.expiresAtMs),
]);

export const chatConversations = mysqlTable("chat_conversations", {
  id: int("id").autoincrement().primaryKey(),
  customerId: int("customer_id").notNull().references(() => users.id),
  status: mysqlEnum("status", ["OPEN", "CLOSED"]).default("OPEN").notNull(),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("chat_customer_unique").on(table.customerId), index("chat_queue_idx").on(table.status, table.lastMessageAt)]);

export const chatMessages = mysqlTable("chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversation_id").notNull().references(() => chatConversations.id),
  senderId: int("sender_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [index("chat_messages_conversation_idx").on(table.conversationId, table.createdAt)]);

export const healthConditions = mysqlTable("health_conditions", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 150 }).notNull(),
  slug: varchar("slug", { length: 170 }).notNull(),
  description: varchar("description", { length: 500 }),
  isActive: boolean("is_active").default(true).notNull(),
  displayOrder: int("display_order").default(0).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("health_conditions_slug_unique").on(table.slug)]);

export const productHealthConditions = mysqlTable("product_health_conditions", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull().references(() => products.id),
  conditionId: int("condition_id").notNull().references(() => healthConditions.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [uniqueIndex("product_condition_unique").on(table.productId, table.conditionId)]);

export const productReviews = mysqlTable("product_reviews", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull().references(() => products.id),
  customerId: int("customer_id").notNull().references(() => users.id),
  rating: int("rating").notNull(),
  comment: text("comment"),
  isApproved: boolean("is_approved").default(false).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("product_customer_review_unique").on(table.productId, table.customerId),
  index("product_reviews_approved_idx").on(table.productId, table.isApproved),
]);

export const emailVerificationTokens = mysqlTable("email_verification_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  expiresAtMs: bigint("expires_at_ms", { mode: "number" }),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [uniqueIndex("email_verification_token_unique").on(table.tokenHash), index("email_verification_user_idx").on(table.userId)]);

export const blogPosts = mysqlTable("blog_posts", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 220 }).notNull(),
  slug: varchar("slug", { length: 240 }).notNull(),
  excerpt: varchar("excerpt", { length: 500 }).notNull(),
  content: text("content").notNull(),
  imageUrl: varchar("image_url", { length: 500 }),
  metaTitle: varchar("meta_title", { length: 220 }),
  metaDescription: varchar("meta_description", { length: 500 }),
  isPublished: boolean("is_published").default(false).notNull(),
  publishedAt: timestamp("published_at"),
  authorId: int("author_id").references(() => users.id),
  ...timestamps,
}, (table) => [uniqueIndex("blog_posts_slug_unique").on(table.slug), index("blog_posts_published_idx").on(table.isPublished, table.publishedAt)]);

// A promotion. A single-product offer carries its price on the offer item and
// temporarily replaces that product's selling price. A bundle carries `bundlePrice`
// and is sold as one line without altering the individual products' prices.
export const offers = mysqlTable("offers", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 180 }).notNull(),
  slug: varchar("slug", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }),
  imageUrl: varchar("image_url", { length: 500 }),
  bundlePrice: decimal("bundle_price", { precision: 12, scale: 2 }),
  startsAt: timestamp("starts_at"),
  endsAt: timestamp("ends_at"),
  isActive: boolean("is_active").default(true).notNull(),
  displayOrder: int("display_order").default(0).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("offers_slug_unique").on(table.slug), index("offers_active_idx").on(table.isActive, table.endsAt)]);

export const offerItems = mysqlTable("offer_items", {
  id: int("id").autoincrement().primaryKey(),
  offerId: int("offer_id").notNull().references(() => offers.id),
  productId: int("product_id").notNull().references(() => products.id),
  // Per-unit price for single-product offers; null on bundle members, whose price
  // is expressed once by offers.bundlePrice.
  offerPrice: decimal("offer_price", { precision: 12, scale: 2 }),
  quantity: int("quantity").default(1).notNull(),
  displayOrder: int("display_order").default(0).notNull(),
}, (table) => [uniqueIndex("offer_item_unique").on(table.offerId, table.productId), index("offer_items_offer_idx").on(table.offerId)]);

// Products promoted inside an article body. Capped at three by the API so the
// reading experience is not swamped.
export const blogPostProducts = mysqlTable("blog_post_products", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("post_id").notNull().references(() => blogPosts.id),
  productId: int("product_id").notNull().references(() => products.id),
  displayOrder: int("display_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [uniqueIndex("blog_post_product_unique").on(table.postId, table.productId), index("blog_post_products_post_idx").on(table.postId)]);

export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  channel: mysqlEnum("channel", ["EMAIL", "SMS", "EMAIL_AND_SMS"]).notNull(),
  subject: varchar("subject", { length: 220 }),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["DRAFT", "SENDING", "SENT", "FAILED"]).default("DRAFT").notNull(),
  recipientCount: int("recipient_count").default(0).notNull(),
  successCount: int("success_count").default(0).notNull(),
  failureCount: int("failure_count").default(0).notNull(),
  createdBy: int("created_by").notNull().references(() => users.id),
  sentAt: timestamp("sent_at"),
  ...timestamps,
}, (table) => [index("campaign_status_idx").on(table.status, table.createdAt)]);
