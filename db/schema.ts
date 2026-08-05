import {
  boolean,
  bigint,
  decimal,
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
  deletedAt: timestamp("deleted_at"),
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

export const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id").notNull().references(() => orders.id),
  productId: int("product_id").references(() => products.id, { onDelete: "set null" }),
  productName: varchar("product_name", { length: 220 }).notNull(),
  quantity: int("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
  lineTotal: decimal("line_total", { precision: 12, scale: 2 }).notNull(),
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
  revokedAt: timestamp("revoked_at"),
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
