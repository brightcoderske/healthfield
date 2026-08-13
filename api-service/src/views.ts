import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  activityLogs,
  blogPostProducts,
  blogPosts,
  branchInventory,
  branches,
  campaigns,
  categories,
  chatConversations,
  chatMessages,
  healthConditions,
  offerItems,
  offers,
  mpesaIncomingPayments,
  orderItemFulfilments,
  orderItems,
  orders,
  paymentTransactions,
  prescriptionRequestItems,
  prescriptions,
  productHealthConditions,
  productReviews,
  products,
  promotionalBanners,
  siteSettings,
  staffPermissions,
  users,
} from "../../db/schema";
import { requireSession, type Session } from "./auth";
import { getDb } from "./db";
import { json, publicImageUrl } from "./http";
import {
  isBundle,
  loadLiveOffers,
  normalTotal,
  offerPriceMap,
  offerTotal,
  type ResolvedOffer,
} from "./offers";
import { paymentConfigurationSummary } from "./payment-handlers";
import { normalizePaymentReference } from "./mpesa";
import {
  requireTeamPermission,
  sessionHasPermission,
} from "./staff-permissions";
import type { StaffPermission } from "../../lib/staff-permissions";

const adminRoles = ["ADMIN", "SUPER_ADMIN"] as const;
const teamRoles = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;
const productCard = {
  id: products.id,
  name: products.name,
  imageUrl: products.imageUrl,
  price: products.price,
  discountPrice: products.discountPrice,
  packSize: products.packSize,
  prescriptionRequired: products.prescriptionRequired,
};
const searchProductCard = {
  ...productCard,
  brand: products.brand,
  categoryId: products.categoryId,
  shortDescription: products.shortDescription,
  description: products.description,
};

async function prescriptionQueue() {
  const db = getDb();
  const [requestRows, itemRows, catalogue, availability] = await Promise.all([
    db
      .select({
        id: prescriptions.id,
        customerId: prescriptions.customerId,
        orderId: prescriptions.orderId,
        senderName: sql<
          string | null
        >`coalesce(${prescriptions.senderName}, trim(concat(${users.firstName}, ' ', ${users.lastName})))`,
        originalFilename: prescriptions.originalFilename,
        mimeType: prescriptions.mimeType,
        sizeBytes: prescriptions.sizeBytes,
        status: prescriptions.status,
        pharmacistNotes: prescriptions.pharmacistNotes,
        reviewedBy: prescriptions.reviewedBy,
        reviewedAt: prescriptions.reviewedAt,
        reviewVersion: prescriptions.reviewVersion,
        createdAt: prescriptions.createdAt,
        updatedAt: prescriptions.updatedAt,
        orderNumber: orders.orderNumber,
        orderStatus: orders.status,
        paymentStatus: orders.paymentStatus,
        orderTotal: orders.total,
      })
      .from(prescriptions)
      .leftJoin(users, eq(users.id, prescriptions.customerId))
      .leftJoin(orders, eq(orders.id, prescriptions.orderId))
      .orderBy(desc(prescriptions.createdAt)),
    db
      .select()
      .from(prescriptionRequestItems)
      .orderBy(prescriptionRequestItems.id),
    db
      .select({
        id: products.id,
        name: products.name,
        packSize: products.packSize,
        price: products.price,
        discountPrice: products.discountPrice,
        prescriptionRequired: products.prescriptionRequired,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name)),
    db
      .select({
        productId: branchInventory.productId,
        available: sql<number>`sum(greatest(${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}, 0))`,
      })
      .from(branchInventory)
      .groupBy(branchInventory.productId),
  ]);
  const availableByProduct = new Map(
    availability.map((row) => [row.productId, Number(row.available)]),
  );
  return {
    prescriptions: requestRows.map((request) => ({
      ...request,
      items: itemRows.filter((item) => item.prescriptionId === request.id),
    })),
    products: catalogue.map((product) => ({
      ...product,
      available: availableByProduct.get(product.id) || 0,
    })),
  };
}

function images<T extends { imageUrl?: string | null }>(rows: T[]) {
  return rows.map((row) => ({
    ...row,
    imageUrl: publicImageUrl(row.imageUrl),
  }));
}

/**
 * Shapes an offer for the storefront: public image paths, computed totals, and — since
 * offers carry no artwork of their own — the first product image that exists stands in
 * as the offer's picture.
 */
function offerPayload(offer: ResolvedOffer) {
  const items = offer.items.map((item) => ({
    ...item,
    imageUrl: publicImageUrl(item.imageUrl),
  }));
  return {
    ...offer,
    items,
    imageUrl:
      publicImageUrl(offer.imageUrl) ??
      items.find((item) => item.imageUrl)?.imageUrl ??
      null,
    isBundle: isBundle(offer),
    total: offerTotal(offer),
    normalTotal: normalTotal(offer),
  };
}

async function home() {
  const db = getDb();
  const [
    rows,
    mappings,
    settingsRows,
    categoryRows,
    conditionRows,
    guideRows,
    promotionalRows,
  ] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        imageUrl: products.imageUrl,
        packSize: products.packSize,
        brand: products.brand,
        categoryId: products.categoryId,
        shortDescription: products.shortDescription,
        description: products.description,
        discountPrice: products.discountPrice,
        prescriptionRequired: products.prescriptionRequired,
        rating: sql<
          string | null
        >`avg(case when ${productReviews.isApproved} = true then ${productReviews.rating} end)`,
        reviewCount: sql<number>`count(case when ${productReviews.isApproved} = true then 1 end)`,
      })
      .from(products)
      .leftJoin(productReviews, eq(productReviews.productId, products.id))
      .where(eq(products.isActive, true))
      .groupBy(products.id)
      .orderBy(desc(products.isFeatured), desc(products.createdAt))
      .limit(50),
    db.select().from(productHealthConditions),
    db.select().from(siteSettings).limit(1),
    db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        featuredOnStorefront: categories.featuredOnStorefront,
      })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(categories.displayOrder),
    db
      .select({
        id: healthConditions.id,
        name: healthConditions.name,
        slug: healthConditions.slug,
      })
      .from(healthConditions)
      .where(eq(healthConditions.isActive, true))
      .orderBy(healthConditions.displayOrder),
    // Recent guides, used to break up the catalogue scroll with reading material.
    db
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        title: blogPosts.title,
        excerpt: blogPosts.excerpt,
        imageUrl: blogPosts.imageUrl,
      })
      .from(blogPosts)
      .where(eq(blogPosts.isPublished, true))
      .orderBy(desc(blogPosts.publishedAt))
      .limit(4),
    db
      .select({
        id: promotionalBanners.id,
        title: promotionalBanners.title,
        imageUrl: promotionalBanners.imageUrl,
        productId: promotionalBanners.productId,
        productName: products.name,
      })
      .from(promotionalBanners)
      .innerJoin(products, eq(products.id, promotionalBanners.productId))
      .where(
        and(eq(promotionalBanners.isActive, true), eq(products.isActive, true)),
      )
      .orderBy(
        asc(promotionalBanners.displayOrder),
        desc(promotionalBanners.createdAt),
      ),
  ]);
  const live = await loadLiveOffers();
  const overrides = offerPriceMap(live);
  const catalog = rows.map((row) => {
    // A live single-product offer presents as the selling price. The stored price is
    // left alone, so the moment the offer ends the original pricing is back.
    const offerPrice = overrides.get(row.id);
    const price = Number(row.price);
    const discountPrice =
      row.discountPrice === null ? null : Number(row.discountPrice);
    return {
      ...row,
      imageUrl: publicImageUrl(row.imageUrl),
      price,
      discountPrice: offerPrice !== undefined ? offerPrice : discountPrice,
      onOffer: offerPrice !== undefined,
      rating: row.rating === null ? null : Number(row.rating),
      reviewCount: Number(row.reviewCount),
      conditionIds: mappings
        .filter((mapping) => mapping.productId === row.id)
        .map((mapping) => mapping.conditionId),
    };
  });
  const settings = settingsRows[0];
  const contact = settings
    ? {
        phone: settings.phone ?? "",
        whatsapp: settings.whatsapp ?? "",
        supportEmail: settings.supportEmail ?? "",
        address: settings.address ?? "",
        openingHours: settings.openingHours ?? "",
        deliveryMessage: settings.deliveryMessage,
        facebookUrl: settings.facebookUrl ?? "",
        instagramUrl: settings.instagramUrl ?? "",
        xUrl: settings.xUrl ?? "",
        tiktokUrl: settings.tiktokUrl ?? "",
        licenceTitle: settings.licenceTitle ?? "",
        licenceNumber: settings.licenceNumber ?? "",
        licenceImageUrl: publicImageUrl(settings.licenceImageUrl),
      }
    : {
        phone: "",
        whatsapp: "",
        supportEmail: "",
        address: "",
        openingHours: "",
        deliveryMessage: "Fast Delivery Across Kenya",
        facebookUrl: "",
        instagramUrl: "",
        xUrl: "",
        tiktokUrl: "",
        licenceTitle: "",
        licenceNumber: "",
        licenceImageUrl: null,
      };
  return {
    offers: live.map(offerPayload),
    catalog,
    contact,
    categories: categoryRows,
    conditions: conditionRows,
    guides: guideRows.map((guide) => ({
      ...guide,
      imageUrl: publicImageUrl(guide.imageUrl),
    })),
    promotions: promotionalRows.map((promotion) => ({
      ...promotion,
      imageUrl: publicImageUrl(promotion.imageUrl),
    })),
  };
}

async function productDetail(id: number) {
  const db = getDb();
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.isActive, true)))
    .limit(1);
  if (!product) return null;
  const [reviewSummary, reviews, conditionLinks, orderLinks, liveOffers] =
    await Promise.all([
      db
        .select({
          rating: sql<string | null>`avg(${productReviews.rating})`,
          count: sql<number>`count(*)`,
        })
        .from(productReviews)
        .where(
          and(
            eq(productReviews.productId, id),
            eq(productReviews.isApproved, true),
          ),
        )
        .then((rows) => rows[0]),
      db
        .select({
          id: productReviews.id,
          rating: productReviews.rating,
          comment: productReviews.comment,
          createdAt: productReviews.createdAt,
          firstName: users.firstName,
        })
        .from(productReviews)
        .innerJoin(users, eq(users.id, productReviews.customerId))
        .where(
          and(
            eq(productReviews.productId, id),
            eq(productReviews.isApproved, true),
          ),
        )
        .orderBy(desc(productReviews.createdAt))
        .limit(20),
      db
        .select({ conditionId: productHealthConditions.conditionId })
        .from(productHealthConditions)
        .where(eq(productHealthConditions.productId, id)),
      db
        .select({ orderId: orderItems.orderId })
        .from(orderItems)
        .where(eq(orderItems.productId, id))
        .limit(100),
      loadLiveOffers(),
    ]);
  const [related, similar, bought] = await Promise.all([
    db
      .select(productCard)
      .from(products)
      .where(
        and(
          eq(products.categoryId, product.categoryId),
          eq(products.isActive, true),
          ne(products.id, id),
        ),
      )
      .orderBy(desc(products.isFeatured), desc(products.createdAt))
      .limit(10),
    conditionLinks.length
      ? db
          .select(productCard)
          .from(products)
          .innerJoin(
            productHealthConditions,
            eq(productHealthConditions.productId, products.id),
          )
          .where(
            and(
              inArray(
                productHealthConditions.conditionId,
                conditionLinks.map((row) => row.conditionId),
              ),
              eq(products.isActive, true),
              ne(products.id, id),
            ),
          )
          .groupBy(products.id)
          .orderBy(desc(products.isFeatured))
          .limit(10)
      : Promise.resolve([]),
    orderLinks.length
      ? db
          .select({
            ...productCard,
            purchases: sql<number>`sum(${orderItems.quantity})`,
          })
          .from(orderItems)
          .innerJoin(products, eq(products.id, orderItems.productId))
          .where(
            and(
              inArray(
                orderItems.orderId,
                orderLinks.map((row) => row.orderId),
              ),
              ne(products.id, id),
              eq(products.isActive, true),
            ),
          )
          .groupBy(products.id)
          .orderBy(desc(sql<number>`sum(${orderItems.quantity})`))
          .limit(10)
      : Promise.resolve([]),
  ]);
  const normalizedRelated = images(related);
  const normalizedSimilar = images(similar);
  const filteredSimilar = normalizedSimilar.filter(
    (item) =>
      !normalizedRelated.some((relatedItem) => relatedItem.id === item.id),
  );
  const liveOfferPrice = offerPriceMap(liveOffers).get(product.id);
  return {
    product: {
      ...product,
      imageUrl: publicImageUrl(product.imageUrl),
      discountPrice: liveOfferPrice ?? product.discountPrice,
    },
    rating:
      reviewSummary?.rating === null ? null : Number(reviewSummary?.rating),
    reviewCount: Number(reviewSummary?.count ?? 0),
    reviews,
    related: normalizedRelated,
    similar: filteredSimilar.length
      ? filteredSimilar
      : normalizedRelated.slice().reverse(),
    bought: bought.length ? images(bought) : normalizedRelated.slice(0, 6),
  };
}

function idsFrom(url: URL) {
  return (url.searchParams.get("ids") || "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 100);
}

function searchTerms(value: string) {
  return value
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter((term) => term.length > 1)
    .slice(0, 6);
}

function matchesEveryTerm(terms: string[]) {
  return terms.map((term) => {
    const match = `%${term}%`;
    return or(
      like(products.name, match),
      like(products.brand, match),
      like(products.shortDescription, match),
      like(products.description, match),
    );
  });
}

async function requireAdmin(request: Request) {
  return requireSession(request, [...adminRoles]);
}

async function requireTeamBranch(
  request: Request,
  permission?: StaffPermission,
): Promise<
  | { response: Response }
  | { session: Session; branch: { id: number; name: string } }
> {
  const auth = permission
    ? await requireTeamPermission(request, permission)
    : await requireSession(request, [...teamRoles]);
  if ("response" in auth) return { response: auth.response! };
  if (!auth.session.homeBranchId)
    return {
      response: json(
        {
          error:
            "This staff account is not assigned to a shop. Ask an administrator to assign one.",
        },
        { status: 409 },
      ),
    } as const;
  const [branch] = await getDb()
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(
      and(
        eq(branches.id, auth.session.homeBranchId),
        eq(branches.isActive, true),
      ),
    )
    .limit(1);
  if (!branch)
    return {
      response: json(
        {
          error:
            "The assigned shop is inactive or unavailable. Ask an administrator to update the staff account.",
        },
        { status: 409 },
      ),
    } as const;
  return { session: auth.session, branch };
}

async function teamOrder(id: number) {
  const db = getDb();
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  if (!order) return null;
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id));
  const [fulfilments, stores, stock, payments] = await Promise.all([
    items.length
      ? db
          .select()
          .from(orderItemFulfilments)
          .where(
            inArray(
              orderItemFulfilments.orderItemId,
              items.map((item) => item.id),
            ),
          )
      : [],
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.isActive, true)),
    items.some((item) => item.productId !== null)
      ? db
          .select({
            productId: branchInventory.productId,
            branchId: branchInventory.branchId,
            available: sql<number>`${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}`,
          })
          .from(branchInventory)
          .where(
            inArray(
              branchInventory.productId,
              items.flatMap((item) =>
                item.productId === null ? [] : [item.productId],
              ),
            ),
          )
      : [],
    db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, id))
      .orderBy(desc(paymentTransactions.createdAt)),
  ]);
  return { order, items, fulfilments, stores, stock, payments };
}

async function contentOfferView() {
  const db = getDb();
  const [offerRows, memberRows, catalogue] = await Promise.all([
    db.select().from(offers).orderBy(asc(offers.displayOrder), desc(offers.id)),
    db
      .select()
      .from(offerItems)
      .orderBy(asc(offerItems.displayOrder), asc(offerItems.id)),
    db
      .select({
        id: products.id,
        name: products.name,
        imageUrl: products.imageUrl,
        price: products.price,
        discountPrice: products.discountPrice,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name)),
  ]);
  return {
    offers: offerRows.map((offer) => ({
      ...offer,
      items: memberRows
        .filter((member) => member.offerId === offer.id)
        .map((member) => ({
          productId: member.productId,
          offerPrice: member.offerPrice,
          quantity: member.quantity,
        })),
    })),
    products: catalogue.map((row) => ({
      ...row,
      imageUrl: publicImageUrl(row.imageUrl),
    })),
  };
}

async function contentBlogView() {
  const db = getDb();
  const [posts, links, catalogue] = await Promise.all([
    db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt)),
    db
      .select({
        postId: blogPostProducts.postId,
        productId: blogPostProducts.productId,
      })
      .from(blogPostProducts)
      .orderBy(asc(blogPostProducts.displayOrder)),
    db
      .select({
        id: products.id,
        name: products.name,
        imageUrl: products.imageUrl,
        price: products.price,
        discountPrice: products.discountPrice,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name)),
  ]);
  return {
    posts: posts.map((post) => ({
      ...post,
      productIds: links
        .filter((link) => link.postId === post.id)
        .map((link) => link.productId),
    })),
    products: catalogue.map((row) => ({
      ...row,
      imageUrl: publicImageUrl(row.imageUrl),
    })),
  };
}

export async function handleView(request: Request, path: string) {
  const url = new URL(request.url);
  if (path === "home")
    return json(await home(), {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  if (path === "locations") {
    const stores = await getDb()
      .select({
        id: branches.id,
        name: branches.name,
        code: branches.code,
        phone: branches.phone,
        email: branches.email,
        address: branches.address,
        latitude: branches.latitude,
        longitude: branches.longitude,
        openingHours: branches.openingHours,
        deliveryAreas: branches.deliveryAreas,
        updatedAt: branches.updatedAt,
      })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(asc(branches.name));
    return json(
      { stores },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  }
  if (path === "conditions") {
    const rows = await getDb()
      .select()
      .from(healthConditions)
      .where(eq(healthConditions.isActive, true))
      .orderBy(asc(healthConditions.displayOrder), asc(healthConditions.name));
    return json(
      { conditions: rows },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  }
  if (path === "blogs") {
    const rows = await getDb()
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.isPublished, true))
      .orderBy(desc(blogPosts.publishedAt));
    // Reading time is derived here so the index never has to ship article bodies.
    const posts = rows.map(({ content, ...post }) => ({
      ...post,
      imageUrl: publicImageUrl(post.imageUrl),
      readMinutes: Math.max(
        1,
        Math.round(content.trim().split(/\s+/).length / 200),
      ),
    }));
    return json(
      { posts },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  }
  const blogMatch = path.match(/^blogs\/([^/]+)$/);
  if (blogMatch) {
    const db = getDb();
    const [post] = await db
      .select()
      .from(blogPosts)
      .where(
        and(
          eq(blogPosts.slug, decodeURIComponent(blogMatch[1])),
          eq(blogPosts.isPublished, true),
        ),
      )
      .limit(1);
    if (!post) return json({ error: "Article not found." }, { status: 404 });
    // Promoted products are resolved live so a de-listed item stops appearing in
    // older articles without anyone editing them.
    const promoted = await db
      .select({
        id: products.id,
        name: products.name,
        imageUrl: products.imageUrl,
        price: products.price,
        discountPrice: products.discountPrice,
        packSize: products.packSize,
        prescriptionRequired: products.prescriptionRequired,
      })
      .from(blogPostProducts)
      .innerJoin(products, eq(products.id, blogPostProducts.productId))
      .where(
        and(eq(blogPostProducts.postId, post.id), eq(products.isActive, true)),
      )
      .orderBy(asc(blogPostProducts.displayOrder));
    return json({
      post,
      products: promoted.map((row) => ({
        ...row,
        imageUrl: publicImageUrl(row.imageUrl),
      })),
    });
  }
  if (path === "search") {
    const terms = searchTerms(url.searchParams.get("q") || "");
    if (!terms.length)
      return json(
        { products: [], similar: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    const matching = matchesEveryTerm(terms);
    const anyMatch = or(...matching);
    const db = getDb();
    const [exact, alternatives] = await Promise.all([
      db
        .select(searchProductCard)
        .from(products)
        .where(and(eq(products.isActive, true), ...matching))
        .orderBy(desc(products.isFeatured), desc(products.createdAt))
        .limit(50),
      db
        .select(searchProductCard)
        .from(products)
        .where(and(eq(products.isActive, true), anyMatch))
        .orderBy(desc(products.isFeatured), desc(products.createdAt))
        .limit(12),
    ]);
    const all = [...exact, ...alternatives];
    const productIds = [...new Set(all.map((product) => product.id))];
    const [mappings, ratings] = productIds.length
      ? await Promise.all([
          db
            .select()
            .from(productHealthConditions)
            .where(inArray(productHealthConditions.productId, productIds)),
          db
            .select({
              productId: productReviews.productId,
              rating: sql<string | null>`avg(${productReviews.rating})`,
              reviewCount: sql<number>`count(*)`,
            })
            .from(productReviews)
            .where(
              and(
                eq(productReviews.isApproved, true),
                inArray(productReviews.productId, productIds),
              ),
            )
            .groupBy(productReviews.productId),
        ])
      : [[], []];
    const conditionsByProduct = new Map<number, number[]>();
    for (const mapping of mappings)
      conditionsByProduct.set(mapping.productId, [
        ...(conditionsByProduct.get(mapping.productId) || []),
        mapping.conditionId,
      ]);
    const ratingsByProduct = new Map(
      ratings.map((rating) => [rating.productId, rating]),
    );
    const shape = (rows: typeof all) =>
      rows.map((product) => ({
        ...product,
        imageUrl: publicImageUrl(product.imageUrl),
        price: Number(product.price),
        discountPrice:
          product.discountPrice === null ? null : Number(product.discountPrice),
        rating:
          ratingsByProduct.get(product.id)?.rating === null ||
          ratingsByProduct.get(product.id)?.rating === undefined
            ? null
            : Number(ratingsByProduct.get(product.id)?.rating),
        reviewCount: Number(ratingsByProduct.get(product.id)?.reviewCount || 0),
        conditionIds: conditionsByProduct.get(product.id) || [],
      }));
    const exactIds = new Set(exact.map((product) => product.id));
    return json(
      {
        products: shape(exact),
        similar: shape(
          alternatives
            .filter((product) => !exactIds.has(product.id))
            .slice(0, 6),
        ),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
        },
      },
    );
  }
  if (path === "catalogue") {
    const ids = idsFrom(url);
    const rows = ids.length
      ? await getDb()
          .select(productCard)
          .from(products)
          .where(and(eq(products.isActive, true), inArray(products.id, ids)))
      : await getDb()
          .select(productCard)
          .from(products)
          .where(eq(products.isActive, true));
    // The cart needs live bundles alongside the products it asked for.
    const liveBundles = (await loadLiveOffers())
      .filter(isBundle)
      .map(offerPayload);
    return json({ products: images(rows), offers: liveBundles });
  }
  const productMatch = path.match(/^products\/(\d+)$/);
  if (productMatch) {
    const detail = await productDetail(Number(productMatch[1]));
    return detail
      ? json(detail, { headers: { "Cache-Control": "public, max-age=60" } })
      : json({ error: "Product not found." }, { status: 404 });
  }
  if (path === "account") {
    const auth = await requireSession(request, ["CUSTOMER"]);
    if ("response" in auth) return auth.response;
    const db = getDb();
    const [orderRows, catalog, prescriptionRows, prescriptionItems] =
      await Promise.all([
        db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.customerId, auth.session.userId),
              ne(orders.status, "AWAITING_PAYMENT"),
            ),
          )
          .orderBy(desc(orders.createdAt)),
        db
          .select(productCard)
          .from(products)
          .where(eq(products.isActive, true))
          .orderBy(desc(products.isFeatured), desc(products.createdAt))
          .limit(24),
        db
          .select({
            id: prescriptions.id,
            orderId: prescriptions.orderId,
            originalFilename: prescriptions.originalFilename,
            status: prescriptions.status,
            pharmacistNotes: prescriptions.pharmacistNotes,
            createdAt: prescriptions.createdAt,
            reviewedAt: prescriptions.reviewedAt,
            orderNumber: orders.orderNumber,
            orderStatus: orders.status,
            paymentStatus: orders.paymentStatus,
            orderTotal: orders.total,
          })
          .from(prescriptions)
          .leftJoin(orders, eq(orders.id, prescriptions.orderId))
          .where(eq(prescriptions.customerId, auth.session.userId))
          .orderBy(desc(prescriptions.createdAt)),
        db
          .select()
          .from(prescriptionRequestItems)
          .innerJoin(
            prescriptions,
            eq(prescriptions.id, prescriptionRequestItems.prescriptionId),
          )
          .where(eq(prescriptions.customerId, auth.session.userId))
          .orderBy(prescriptionRequestItems.id),
      ]);
    return json({
      orders: orderRows,
      catalog: images(catalog),
      prescriptions: prescriptionRows.map((request) => ({
        ...request,
        items: prescriptionItems
          .filter(
            (row) =>
              row.prescription_request_items.prescriptionId === request.id,
          )
          .map((row) => row.prescription_request_items),
      })),
    });
  }
  const customerPrescriptionMatch = path.match(
    /^account\/prescriptions\/(\d+)$/,
  );
  if (customerPrescriptionMatch) {
    const auth = await requireSession(request, ["CUSTOMER"]);
    if ("response" in auth) return auth.response;
    const id = Number(customerPrescriptionMatch[1]);
    const db = getDb();
    const [prescription] = await db
      .select()
      .from(prescriptions)
      .where(
        and(
          eq(prescriptions.id, id),
          eq(prescriptions.customerId, auth.session.userId),
        ),
      )
      .limit(1);
    if (!prescription)
      return json(
        { error: "Prescription request not found." },
        { status: 404 },
      );
    const [items, orderRows, customerRows, settingsRows] = await Promise.all([
      db
        .select()
        .from(prescriptionRequestItems)
        .where(eq(prescriptionRequestItems.prescriptionId, id))
        .orderBy(prescriptionRequestItems.id),
      prescription.orderId
        ? db
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.id, prescription.orderId),
                eq(orders.customerId, auth.session.userId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      db
        .select({
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          phone: users.phone,
        })
        .from(users)
        .where(eq(users.id, auth.session.userId))
        .limit(1),
      db
        .select({
          onlineMpesaEnabled: siteSettings.onlineMpesaEnabled,
          onlineManualEnabled: siteSettings.onlineManualEnabled,
          mpesaTillNumber: siteSettings.mpesaTillNumber,
          mpesaAccountName: siteSettings.mpesaAccountName,
        })
        .from(siteSettings)
        .limit(1),
    ]);
    const settings = settingsRows[0];
    return json({
      request: prescription,
      items,
      order: orderRows[0] || null,
      customer: customerRows[0],
      payment: {
        onlineMpesaEnabled: Boolean(
          settings?.onlineMpesaEnabled &&
          paymentConfigurationSummary().mpesaConfigured,
        ),
        onlineManualEnabled: Boolean(
          settings?.onlineManualEnabled && settings.mpesaTillNumber,
        ),
        tillNumber: settings?.mpesaTillNumber || null,
        accountName: settings?.mpesaAccountName || null,
      },
    });
  }
  const customerOrderMatch = path.match(/^account\/orders\/(\d+)$/);
  if (customerOrderMatch) {
    const auth = await requireSession(request, ["CUSTOMER"]);
    if ("response" in auth) return auth.response;
    const id = Number(customerOrderMatch[1]);
    const db = getDb();
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.customerId, auth.session.userId)))
      .limit(1);
    if (!order) return json({ error: "Order not found." }, { status: 404 });
    const [items, settingsRows] = await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, id)),
      db
        .select({ onlineMpesaEnabled: siteSettings.onlineMpesaEnabled })
        .from(siteSettings)
        .limit(1),
    ]);
    return json({
      order,
      items,
      payment: {
        mpesaEnabled: Boolean(
          settingsRows[0]?.onlineMpesaEnabled &&
          paymentConfigurationSummary().mpesaConfigured,
        ),
      },
    });
  }
  if (path === "checkout") {
    const ids = idsFrom(url);
    const auth = await requireSession(request);
    const session = "session" in auth ? auth.session : null;
    const db = getDb();
    const catalog = ids.length
      ? await db
          .select(productCard)
          .from(products)
          .where(inArray(products.id, ids))
      : [];
    const [customer] =
      session?.role === "CUSTOMER"
        ? await db
            .select({
              firstName: users.firstName,
              lastName: users.lastName,
              email: users.email,
              phone: users.phone,
            })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1)
        : [null];
    const [settings] = await db
      .select({
        onlineMpesaEnabled: siteSettings.onlineMpesaEnabled,
        onlineManualEnabled: siteSettings.onlineManualEnabled,
        mpesaTillNumber: siteSettings.mpesaTillNumber,
        mpesaAccountName: siteSettings.mpesaAccountName,
      })
      .from(siteSettings)
      .limit(1);
    // Bundles are resolved server-side so checkout prices what is live right now
    // rather than whatever the basket cookie remembers.
    const liveOffers = (await loadLiveOffers())
      .filter(isBundle)
      .map(offerPayload);
    return json({
      catalog: images(catalog),
      offers: liveOffers,
      customer: customer ?? null,
      payment: {
        onlineMpesaEnabled: Boolean(
          settings?.onlineMpesaEnabled &&
          paymentConfigurationSummary().mpesaConfigured,
        ),
        onlineManualEnabled: Boolean(
          settings?.onlineManualEnabled && settings.mpesaTillNumber,
        ),
        tillNumber: settings?.mpesaTillNumber || null,
        accountName: settings?.mpesaAccountName || null,
      },
    });
  }
  if (path === "sitemap") {
    const productRows = await getDb()
      .select({ id: products.id, updatedAt: products.updatedAt })
      .from(products)
      .where(eq(products.isActive, true));
    return json(
      { products: productRows },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  }
  if (path === "merchant") {
    const [rows, liveOffers] = await Promise.all([
      getDb()
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          description: products.description,
          imageUrl: products.imageUrl,
          price: products.price,
          discountPrice: products.discountPrice,
          brand: products.brand,
          barcode: products.barcode,
          packSize: products.packSize,
          category: categories.name,
          prescriptionRequired: products.prescriptionRequired,
          rating: sql<
            string | null
          >`avg(case when ${productReviews.isApproved}=true then ${productReviews.rating} end)`,
          reviewCount: sql<number>`count(case when ${productReviews.isApproved}=true then 1 end)`,
        })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .leftJoin(productReviews, eq(productReviews.productId, products.id))
        .where(eq(products.isActive, true))
        .groupBy(products.id, categories.name),
      loadLiveOffers(),
    ]);
    const liveOfferPrices = offerPriceMap(liveOffers);
    return json(
      {
        products: rows.map((row) => ({
          ...row,
          imageUrl: publicImageUrl(row.imageUrl),
          discountPrice: liveOfferPrices.get(row.id) ?? row.discountPrice,
        })),
      },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  }

  if (path.startsWith("admin/")) {
    const auth = await requireAdmin(request);
    if ("response" in auth) return auth.response;
    const db = getDb();
    const view = path.slice(6);
    if (view === "navigation") {
      const [[{ newOrders }], [{ newChats }], [{ unmatchedPayments }]] =
        await Promise.all([
          db
            .select({ newOrders: count() })
            .from(orders)
            .where(eq(orders.status, "NEW")),
          db
            .select({
              newChats: sql<number>`count(distinct ${chatMessages.conversationId})`,
            })
            .from(chatMessages)
            .innerJoin(users, eq(users.id, chatMessages.senderId))
            .where(
              and(eq(users.role, "CUSTOMER"), isNull(chatMessages.readAt)),
            ),
          db
            .select({ unmatchedPayments: count() })
            .from(mpesaIncomingPayments)
            .where(isNull(mpesaIncomingPayments.matchedTransactionId)),
        ]);
      return json({
        newOrders: Number(newOrders),
        newChats: Number(newChats),
        unmatchedPayments: Number(unmatchedPayments),
      });
    }
    if (view === "dashboard") {
      const since = new Date(Date.now() - 92 * 24 * 60 * 60 * 1000);
      const [
        [{ newOrders }],
        [{ pendingPrescriptions }],
        [{ activeProducts }],
        [{ lowStock }],
        [{ customers }],
        [{ newChats }],
        recentOrders,
        analytics,
      ] = await Promise.all([
        db
          .select({ newOrders: count() })
          .from(orders)
          .where(eq(orders.status, "NEW")),
        db
          .select({ pendingPrescriptions: count() })
          .from(prescriptions)
          .where(
            inArray(prescriptions.status, [
              "RECEIVED",
              "UNDER_REVIEW",
              "MORE_INFORMATION_REQUIRED",
            ]),
          ),
        db
          .select({ activeProducts: count() })
          .from(products)
          .where(eq(products.isActive, true)),
        db
          .select({ lowStock: count() })
          .from(branchInventory)
          .where(
            sql`greatest(${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}, 0) <= ${branchInventory.reorderLevel}`,
          ),
        db
          .select({ customers: count() })
          .from(users)
          .where(eq(users.role, "CUSTOMER")),
        db
          .select({
            newChats: sql<number>`count(distinct ${chatMessages.conversationId})`,
          })
          .from(chatMessages)
          .innerJoin(users, eq(users.id, chatMessages.senderId))
          .where(and(eq(users.role, "CUSTOMER"), isNull(chatMessages.readAt))),
        db.select().from(orders).orderBy(desc(orders.createdAt)).limit(8),
        db
          .select({
            orderId: orders.id,
            createdAt: orders.createdAt,
            status: orders.status,
            total: orders.total,
            branch: branches.name,
            productName: orderItems.productName,
            quantity: orderItems.quantity,
            lineTotal: orderItems.lineTotal,
            category: categories.name,
          })
          .from(orders)
          .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
          .leftJoin(products, eq(products.id, orderItems.productId))
          .leftJoin(categories, eq(categories.id, products.categoryId))
          .leftJoin(branches, eq(branches.id, orders.suggestedBranchId))
          .where(
            and(gte(orders.createdAt, since), ne(orders.status, "CANCELLED")),
          ),
      ]);
      return json({
        newOrders,
        pendingPrescriptions,
        activeProducts,
        lowStock,
        customers,
        newChats: Number(newChats),
        recentOrders,
        analytics,
      });
    }
    if (view === "orders")
      return json({
        orders: await db
          .select()
          .from(orders)
          .orderBy(
            sql`case when ${orders.status}='NEW' then 0 when ${orders.status} in ('CONFIRMED','UNDER_REVIEW') then 1 else 2 end`,
            desc(orders.createdAt),
          ),
      });
    const orderMatch = view.match(/^orders\/(\d+)$/);
    if (orderMatch) {
      const id = Number(orderMatch[1]);
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);
      if (!order) return json({ error: "Order not found." }, { status: 404 });
      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, id));
      const [fulfilments, stores, stock, payments] = await Promise.all([
        items.length
          ? db
              .select()
              .from(orderItemFulfilments)
              .where(
                inArray(
                  orderItemFulfilments.orderItemId,
                  items.map((item) => item.id),
                ),
              )
          : [],
        db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.isActive, true)),
        items.some((item) => item.productId !== null)
          ? db
              .select({
                productId: branchInventory.productId,
                branchId: branchInventory.branchId,
                available: sql<number>`${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}`,
              })
              .from(branchInventory)
              .where(
                inArray(
                  branchInventory.productId,
                  items.flatMap((item) =>
                    item.productId === null ? [] : [item.productId],
                  ),
                ),
              )
          : [],
        db
          .select()
          .from(paymentTransactions)
          .where(eq(paymentTransactions.orderId, id))
          .orderBy(desc(paymentTransactions.createdAt)),
      ]);
      return json({ order, items, fulfilments, stores, stock, payments });
    }
    if (view === "customers")
      return json({
        customers: await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            phone: users.phone,
            isActive: users.isActive,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.role, "CUSTOMER"))
          .orderBy(desc(users.createdAt)),
      });
    const customerMatch = view.match(/^customers\/(\d+)$/);
    if (customerMatch) {
      const customerId = Number(customerMatch[1]);
      const [customer] = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          phone: users.phone,
          isActive: users.isActive,
          emailVerifiedAt: users.emailVerifiedAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(and(eq(users.id, customerId), eq(users.role, "CUSTOMER")))
        .limit(1);
      if (!customer)
        return json({ error: "Customer not found." }, { status: 404 });
      const [customerOrders, customerPrescriptions] = await Promise.all([
        db
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            paymentStatus: orders.paymentStatus,
            paymentMethod: orders.paymentMethod,
            total: orders.total,
            createdAt: orders.createdAt,
          })
          .from(orders)
          .where(eq(orders.customerId, customerId))
          .orderBy(desc(orders.createdAt)),
        db
          .select({
            id: prescriptions.id,
            orderId: prescriptions.orderId,
            originalFilename: prescriptions.originalFilename,
            status: prescriptions.status,
            pharmacistNotes: prescriptions.pharmacistNotes,
            createdAt: prescriptions.createdAt,
          })
          .from(prescriptions)
          .where(eq(prescriptions.customerId, customerId))
          .orderBy(desc(prescriptions.createdAt)),
      ]);
      return json({
        customer,
        orders: customerOrders,
        prescriptions: customerPrescriptions,
      });
    }
    if (view === "chats") {
      const [chats, unread] = await Promise.all([
        db
          .select({
            id: chatConversations.id,
            status: chatConversations.status,
            lastMessageAt: chatConversations.lastMessageAt,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
          })
          .from(chatConversations)
          .innerJoin(users, eq(users.id, chatConversations.customerId))
          .orderBy(desc(chatConversations.lastMessageAt)),
        db
          .select({
            conversationId: chatMessages.conversationId,
            total: count(),
          })
          .from(chatMessages)
          .innerJoin(users, eq(users.id, chatMessages.senderId))
          .where(and(eq(users.role, "CUSTOMER"), isNull(chatMessages.readAt)))
          .groupBy(chatMessages.conversationId),
      ]);
      return json({
        chats: chats.map((chat) => ({
          ...chat,
          unread: Number(
            unread.find((row) => row.conversationId === chat.id)?.total || 0,
          ),
        })),
      });
    }
    if (view === "prescriptions") return json(await prescriptionQueue());
    if (view === "campaigns")
      return json({
        campaigns: await db
          .select()
          .from(campaigns)
          .orderBy(desc(campaigns.createdAt))
          .limit(30),
      });
    if (view === "stores")
      return json({
        stores: await db
          .select()
          .from(branches)
          .orderBy(desc(branches.createdAt)),
      });
    if (view === "staff") {
      const [staff, stores, permissionRows] = await Promise.all([
        db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            phone: users.phone,
            role: users.role,
            homeBranchId: users.homeBranchId,
            isActive: users.isActive,
            twoFactorEnabled: users.twoFactorEnabled,
          })
          .from(users)
          .where(and(ne(users.role, "CUSTOMER"), isNull(users.deletedAt)))
          .orderBy(desc(users.createdAt)),
        db.select({ id: branches.id, name: branches.name }).from(branches),
        db
          .select({
            userId: staffPermissions.userId,
            permission: staffPermissions.permission,
          })
          .from(staffPermissions)
          .orderBy(staffPermissions.permission),
      ]);
      return json({
        staff: staff.map((member) => ({
          ...member,
          permissions: permissionRows
            .filter((row) => row.userId === member.id)
            .map((row) => row.permission),
        })),
        stores,
      });
    }
    if (view === "activity") {
      const logs = await db
        .select()
        .from(activityLogs)
        .orderBy(desc(activityLogs.createdAt))
        .limit(500);
      const actorIds = [
        ...new Set(
          logs.flatMap((entry) =>
            entry.actorId === null ? [] : [entry.actorId],
          ),
        ),
      ];
      const actors = actorIds.length
        ? await db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              email: users.email,
            })
            .from(users)
            .where(inArray(users.id, actorIds))
        : [];
      return json({
        activities: logs.map((entry) => ({
          ...entry,
          actor: actors.find((actor) => actor.id === entry.actorId) || null,
        })),
      });
    }
    if (view === "unmatched-payments") {
      const [incoming, candidates, exceptions] = await Promise.all([
        db
          .select()
          .from(mpesaIncomingPayments)
          .where(isNull(mpesaIncomingPayments.matchedTransactionId))
          .orderBy(desc(mpesaIncomingPayments.createdAt))
          .limit(500),
        db
          .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            customerName: orders.customerName,
            phone: orders.phone,
            total: orders.total,
            orderStatus: orders.status,
            paymentStatus: orders.paymentStatus,
            paymentId: paymentTransactions.id,
            paymentMethod: paymentTransactions.method,
            paymentAttemptStatus: paymentTransactions.status,
            createdAt: paymentTransactions.createdAt,
          })
          .from(paymentTransactions)
          .innerJoin(orders, eq(orders.id, paymentTransactions.orderId))
          .where(
            and(
              inArray(paymentTransactions.status, [
                "PENDING",
                "CANCEL_REQUESTED",
                "REQUIRES_REVIEW",
                "FAILED",
                "CANCELLED",
              ]),
              gte(
                paymentTransactions.createdAt,
                new Date(Date.now() - 24 * 60 * 60_000),
              ),
            ),
          )
          .orderBy(desc(paymentTransactions.createdAt))
          .limit(300),
        db
          .select({
            paymentId: paymentTransactions.id,
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            customerName: orders.customerName,
            amount: paymentTransactions.amount,
            phone: paymentTransactions.phone,
            method: paymentTransactions.method,
            status: paymentTransactions.status,
            resultCode: paymentTransactions.resultCode,
            resultDescription: paymentTransactions.resultDescription,
            createdAt: paymentTransactions.createdAt,
          })
          .from(paymentTransactions)
          .innerJoin(orders, eq(orders.id, paymentTransactions.orderId))
          .where(
            inArray(paymentTransactions.status, [
              "CANCEL_REQUESTED",
              "REQUIRES_REVIEW",
            ]),
          )
          .orderBy(desc(paymentTransactions.createdAt))
          .limit(200),
      ]);
      const payments = incoming.map((item) => {
        const amountMatches = candidates.filter(
          (candidate) =>
            Math.abs(Number(candidate.total) - Number(item.amount)) <= 0.001,
        );
        const reference = normalizePaymentReference(item.accountReference);
        const referenceMatches = reference
          ? amountMatches.filter((candidate) => {
              const order = normalizePaymentReference(candidate.orderNumber);
              return reference === order || reference === order.slice(0, 12);
            })
          : [];
        const suggestion =
          referenceMatches.length === 1
            ? referenceMatches[0]
            : amountMatches.length === 1
              ? amountMatches[0]
              : null;
        return { ...item, suggestion };
      });
      return json({ payments, exceptions });
    }
    if (view === "settings")
      return json({
        settings: (await db.select().from(siteSettings).limit(1))[0] ?? null,
        paymentRuntime: paymentConfigurationSummary(),
      });
    if (view === "offers") {
      // Every offer regardless of state, so an administrator can revive an expired one.
      const [offerRows, memberRows, catalogue] = await Promise.all([
        db
          .select()
          .from(offers)
          .orderBy(asc(offers.displayOrder), desc(offers.id)),
        db
          .select()
          .from(offerItems)
          .orderBy(asc(offerItems.displayOrder), asc(offerItems.id)),
        db
          .select({
            id: products.id,
            name: products.name,
            imageUrl: products.imageUrl,
            price: products.price,
            discountPrice: products.discountPrice,
          })
          .from(products)
          .where(eq(products.isActive, true))
          .orderBy(asc(products.name)),
      ]);
      return json({
        offers: offerRows.map((offer) => ({
          ...offer,
          items: memberRows
            .filter((member) => member.offerId === offer.id)
            .map((member) => ({
              productId: member.productId,
              offerPrice: member.offerPrice,
              quantity: member.quantity,
            })),
        })),
        products: catalogue.map((row) => ({
          ...row,
          imageUrl: publicImageUrl(row.imageUrl),
        })),
      });
    }
    if (view === "blogs") {
      const [posts, links, catalogue] = await Promise.all([
        db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt)),
        db
          .select({
            postId: blogPostProducts.postId,
            productId: blogPostProducts.productId,
          })
          .from(blogPostProducts)
          .orderBy(asc(blogPostProducts.displayOrder)),
        db
          .select({
            id: products.id,
            name: products.name,
            imageUrl: products.imageUrl,
            price: products.price,
            discountPrice: products.discountPrice,
          })
          .from(products)
          .where(eq(products.isActive, true))
          .orderBy(asc(products.name)),
      ]);
      return json({
        posts: posts.map((post) => ({
          ...post,
          productIds: links
            .filter((link) => link.postId === post.id)
            .map((link) => link.productId),
        })),
        products: catalogue.map((row) => ({
          ...row,
          imageUrl: publicImageUrl(row.imageUrl),
        })),
      });
    }
    if (view === "promotional-banners") {
      const [banners, catalogue] = await Promise.all([
        db
          .select()
          .from(promotionalBanners)
          .orderBy(
            asc(promotionalBanners.displayOrder),
            desc(promotionalBanners.createdAt),
          ),
        db
          .select({
            id: products.id,
            name: products.name,
            imageUrl: products.imageUrl,
            price: products.price,
            discountPrice: products.discountPrice,
          })
          .from(products)
          .where(eq(products.isActive, true))
          .orderBy(asc(products.name)),
      ]);
      return json({
        banners: banners.map((banner) => ({
          ...banner,
          imageUrl: publicImageUrl(banner.imageUrl),
        })),
        products: catalogue.map((row) => ({
          ...row,
          imageUrl: publicImageUrl(row.imageUrl),
        })),
      });
    }
    if (view === "products") {
      const [catalog, categoryRows, conditions, mappings] = await Promise.all([
        db.select().from(products).orderBy(desc(products.createdAt)),
        db
          .select()
          .from(categories)
          .where(eq(categories.isActive, true))
          .orderBy(asc(categories.displayOrder)),
        db
          .select()
          .from(healthConditions)
          .where(eq(healthConditions.isActive, true))
          .orderBy(asc(healthConditions.displayOrder)),
        db.select().from(productHealthConditions),
      ]);
      return json({
        products: catalog.map((product) => ({
          ...product,
          imageUrl: publicImageUrl(product.imageUrl),
          price: Number(product.price),
          discountPrice: product.discountPrice
            ? Number(product.discountPrice)
            : null,
          conditionIds: mappings
            .filter((mapping) => mapping.productId === product.id)
            .map((mapping) => mapping.conditionId),
        })),
        categories: categoryRows,
        conditions,
      });
    }
    if (view === "inventory") {
      const [catalog, stock, sales] = await Promise.all([
        db
          .select({
            id: products.id,
            name: products.name,
            imageUrl: products.imageUrl,
            brand: products.brand,
            packSize: products.packSize,
            isActive: products.isActive,
          })
          .from(products)
          .orderBy(asc(products.name)),
        db
          .select({
            id: branchInventory.id,
            productId: branchInventory.productId,
            branchId: branches.id,
            branch: branches.name,
            available: branchInventory.quantityAvailable,
            reserved: branchInventory.quantityReserved,
            reorder: branchInventory.reorderLevel,
          })
          .from(branchInventory)
          .innerJoin(branches, eq(branchInventory.branchId, branches.id)),
        db
          .select({
            productId: orderItems.productId,
            sold: sql<number>`coalesce(sum(${orderItems.quantity}),0)`,
          })
          .from(orderItems)
          .groupBy(orderItems.productId),
      ]);
      return json({
        products: images(catalog).map((product) => ({
          ...product,
          stores: stock.filter((row) => row.productId === product.id),
          sold: Number(
            sales.find((row) => row.productId === product.id)?.sold || 0,
          ),
        })),
      });
    }
    return json({ error: "Admin view not found." }, { status: 404 });
  }

  if (path === "staff/navigation") {
    const auth = await requireTeamBranch(request);
    if ("response" in auth) return auth.response;
    const canViewOrders = sessionHasPermission(auth.session, "ORDERS_VIEW");
    const canViewPrescriptions = sessionHasPermission(
      auth.session,
      "PRESCRIPTIONS_VIEW",
    );
    const [[{ newOrders }], [{ pendingPrescriptions }]] = await Promise.all([
      canViewOrders
        ? getDb()
            .select({ newOrders: count() })
            .from(orders)
            .where(eq(orders.status, "NEW"))
        : Promise.resolve([{ newOrders: 0 }]),
      canViewPrescriptions
        ? getDb()
            .select({ pendingPrescriptions: count() })
            .from(prescriptions)
            .where(
              inArray(prescriptions.status, [
                "RECEIVED",
                "UNDER_REVIEW",
                "MORE_INFORMATION_REQUIRED",
              ]),
            )
        : Promise.resolve([{ pendingPrescriptions: 0 }]),
    ]);
    return json({
      newOrders: Number(newOrders),
      pendingPrescriptions: Number(pendingPrescriptions),
      branch: auth.branch,
      permissions: auth.session.permissions,
    });
  }
  if (path === "staff/dashboard") {
    const auth = await requireTeamBranch(request, "DASHBOARD_VIEW");
    if ("response" in auth) return auth.response;
    const db = getDb(),
      branchId = auth.branch.id;
    const since = new Date(Date.now() - 92 * 24 * 60 * 60 * 1000);
    const [
      [{ newOrders }],
      [{ pendingPrescriptions }],
      [{ activeProducts }],
      [{ lowStock }],
      recentOrders,
      analytics,
    ] = await Promise.all([
      db
        .select({ newOrders: count() })
        .from(orders)
        .where(eq(orders.status, "NEW")),
      db
        .select({ pendingPrescriptions: count() })
        .from(prescriptions)
        .where(
          inArray(prescriptions.status, [
            "RECEIVED",
            "UNDER_REVIEW",
            "MORE_INFORMATION_REQUIRED",
          ]),
        ),
      db
        .select({ activeProducts: count() })
        .from(branchInventory)
        .innerJoin(products, eq(products.id, branchInventory.productId))
        .where(
          and(
            eq(branchInventory.branchId, branchId),
            eq(products.isActive, true),
          ),
        ),
      db
        .select({ lowStock: count() })
        .from(branchInventory)
        .where(
          and(
            eq(branchInventory.branchId, branchId),
            sql`greatest(${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}, 0) <= ${branchInventory.reorderLevel}`,
          ),
        ),
      db.select().from(orders).orderBy(desc(orders.createdAt)).limit(8),
      db
        .select({
          orderId: orders.id,
          createdAt: orders.createdAt,
          status: orders.status,
          total: orders.total,
          branch: branches.name,
          productName: orderItems.productName,
          quantity: orderItems.quantity,
          lineTotal: orderItems.lineTotal,
          category: categories.name,
        })
        .from(orderItemFulfilments)
        .innerJoin(
          orderItems,
          eq(orderItems.id, orderItemFulfilments.orderItemId),
        )
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .innerJoin(branches, eq(branches.id, orderItemFulfilments.branchId))
        .leftJoin(products, eq(products.id, orderItems.productId))
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(
          and(
            eq(orderItemFulfilments.branchId, branchId),
            gte(orders.createdAt, since),
            ne(orders.status, "CANCELLED"),
          ),
        ),
    ]);
    return json({
      newOrders: Number(newOrders),
      pendingPrescriptions: Number(pendingPrescriptions),
      activeProducts: Number(activeProducts),
      lowStock: Number(lowStock),
      customers: 0,
      recentOrders,
      analytics,
      branch: auth.branch,
    });
  }
  if (path === "staff/orders") {
    const auth = await requireTeamPermission(request, "ORDERS_VIEW");
    if ("response" in auth) return auth.response;
    return json({
      orders: await getDb()
        .select()
        .from(orders)
        .orderBy(
          sql`case when ${orders.status}='NEW' then 0 when ${orders.status} in ('CONFIRMED','UNDER_REVIEW') then 1 else 2 end`,
          desc(orders.createdAt),
        ),
    });
  }
  if (path === "staff/past-orders") {
    const auth = await requireTeamPermission(request, "PAST_ORDERS_VIEW");
    if ("response" in auth) return auth.response;
    return json({
      orders: await getDb()
        .select()
        .from(orders)
        .orderBy(desc(orders.createdAt)),
    });
  }
  const staffOrderMatch = path.match(/^staff\/orders\/(\d+)$/);
  if (staffOrderMatch) {
    const auth = await requireTeamPermission(request, "ORDERS_VIEW");
    if ("response" in auth) return auth.response;
    const data = await teamOrder(Number(staffOrderMatch[1]));
    return data
      ? json(data)
      : json({ error: "Order not found." }, { status: 404 });
  }
  const staffReceiptMatch = path.match(/^staff\/receipts\/orders\/(\d+)$/);
  if (staffReceiptMatch) {
    const auth = await requireTeamPermission(request, "RECEIPTS_VIEW");
    if ("response" in auth) return auth.response;
    const data = await teamOrder(Number(staffReceiptMatch[1]));
    if (!data) return json({ error: "Order not found." }, { status: 404 });
    await getDb()
      .insert(activityLogs)
      .values({
        actorId: auth.session.userId,
        action: "RECEIPT_VIEWED",
        entityType: "order",
        entityId: String(data.order.id),
        metadata: {
          orderNumber: data.order.orderNumber,
          actorRole: auth.session.role,
        },
      });
    return json(data);
  }
  if (path === "staff/inventory") {
    const auth = await requireTeamBranch(request, "INVENTORY_VIEW");
    if ("response" in auth) return auth.response;
    const db = getDb(),
      branchId = auth.branch.id;
    const [catalog, stock, sales] = await Promise.all([
      db
        .select({
          id: products.id,
          name: products.name,
          imageUrl: products.imageUrl,
          brand: products.brand,
          packSize: products.packSize,
          isActive: products.isActive,
        })
        .from(products)
        .innerJoin(branchInventory, eq(branchInventory.productId, products.id))
        .where(eq(branchInventory.branchId, branchId))
        .orderBy(asc(products.name)),
      db
        .select({
          id: branchInventory.id,
          productId: branchInventory.productId,
          branchId: branches.id,
          branch: branches.name,
          available: branchInventory.quantityAvailable,
          reserved: branchInventory.quantityReserved,
          reorder: branchInventory.reorderLevel,
        })
        .from(branchInventory)
        .innerJoin(branches, eq(branchInventory.branchId, branches.id))
        .where(eq(branchInventory.branchId, branchId)),
      db
        .select({
          productId: orderItems.productId,
          sold: sql<number>`coalesce(sum(${orderItems.quantity}),0)`,
        })
        .from(orderItemFulfilments)
        .innerJoin(
          orderItems,
          eq(orderItems.id, orderItemFulfilments.orderItemId),
        )
        .where(eq(orderItemFulfilments.branchId, branchId))
        .groupBy(orderItems.productId),
    ]);
    return json({
      branch: auth.branch,
      products: images(catalog).map((product) => ({
        ...product,
        stores: stock.filter((row) => row.productId === product.id),
        sold: Number(
          sales.find((row) => row.productId === product.id)?.sold || 0,
        ),
      })),
    });
  }
  if (path === "staff/prescriptions") {
    const auth = await requireTeamPermission(request, "PRESCRIPTIONS_VIEW");
    if ("response" in auth) return auth.response;
    return json(await prescriptionQueue());
  }
  if (path === "walk-in-sale") {
    const auth = await requireTeamPermission(request, "POS_USE");
    if ("response" in auth) return auth.response;
    if (auth.session.role === "STAFF" && !auth.session.homeBranchId)
      return json(
        {
          error:
            "This staff account is not assigned to a shop. Ask an administrator to assign one before using POS.",
        },
        { status: 409 },
      );
    const branchFilter =
      auth.session.role === "STAFF"
        ? eq(branches.id, auth.session.homeBranchId!)
        : undefined;
    const stockFilter =
      auth.session.role === "STAFF"
        ? eq(branchInventory.branchId, auth.session.homeBranchId!)
        : undefined;
    const [branchRows, productRows, stockRows, paymentRows] = await Promise.all(
      [
        getDb()
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(
            branchFilter
              ? and(eq(branches.isActive, true), branchFilter)
              : eq(branches.isActive, true),
          )
          .orderBy(asc(branches.name)),
        getDb()
          .select({
            id: products.id,
            name: products.name,
            sku: products.sku,
            price: products.price,
            discountPrice: products.discountPrice,
          })
          .from(products)
          .where(eq(products.isActive, true))
          .orderBy(asc(products.name)),
        getDb()
          .select({
            branchId: branchInventory.branchId,
            productId: branchInventory.productId,
            available: sql<number>`${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}`,
          })
          .from(branchInventory)
          .where(stockFilter),
        getDb()
          .select({
            posCashEnabled: siteSettings.posCashEnabled,
            posMpesaEnabled: siteSettings.posMpesaEnabled,
            posManualEnabled: siteSettings.posManualEnabled,
            mpesaTillNumber: siteSettings.mpesaTillNumber,
            mpesaAccountName: siteSettings.mpesaAccountName,
            bulkSmsApiUrl: siteSettings.bulkSmsApiUrl,
            bulkSmsApiKey: siteSettings.bulkSmsApiKey,
            bulkSmsSenderId: siteSettings.bulkSmsSenderId,
          })
          .from(siteSettings)
          .limit(1),
      ],
    );
    return json({
      branches: branchRows,
      products: productRows.map((product) => ({
        ...product,
        price: Number(product.price),
        discountPrice:
          product.discountPrice === null ? null : Number(product.discountPrice),
      })),
      stock: stockRows,
      payment: {
        cashEnabled: paymentRows[0]?.posCashEnabled ?? true,
        mpesaEnabled: Boolean(
          paymentRows[0]?.posMpesaEnabled &&
          paymentConfigurationSummary().mpesaConfigured,
        ),
        manualEnabled: Boolean(
          paymentRows[0]?.posManualEnabled && paymentRows[0]?.mpesaTillNumber,
        ),
        smsEnabled: Boolean(
          paymentRows[0]?.bulkSmsApiUrl &&
          paymentRows[0]?.bulkSmsApiKey &&
          paymentRows[0]?.bulkSmsSenderId,
        ),
        tillNumber: paymentRows[0]?.mpesaTillNumber || null,
        accountName: paymentRows[0]?.mpesaAccountName || null,
      },
    });
  }
  if (path === "staff/offers") {
    const auth = await requireTeamPermission(request, "OFFERS_MANAGE");
    if ("response" in auth) return auth.response;
    return json(await contentOfferView());
  }
  if (path === "staff/blogs") {
    const auth = await requireTeamPermission(request, "BLOGS_MANAGE");
    if ("response" in auth) return auth.response;
    return json(await contentBlogView());
  }
  if (path === "staff/products") {
    const auth = await requireTeamPermission(request, "PRODUCTS_VIEW");
    if ("response" in auth) return auth.response;
    const rows = await getDb()
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        brand: products.brand,
        packSize: products.packSize,
        imageUrl: products.imageUrl,
        price: products.price,
        discountPrice: products.discountPrice,
        prescriptionRequired: products.prescriptionRequired,
        isActive: products.isActive,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name));
    return json({
      products: images(rows).map((product) => ({
        ...product,
        price: Number(product.price),
        discountPrice:
          product.discountPrice === null ? null : Number(product.discountPrice),
      })),
    });
  }
  return json({ error: "View not found." }, { status: 404 });
}
