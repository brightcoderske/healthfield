import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { branchInventory, branches, deliveryBands, orderItems, orders, siteSettings } from "../../db/schema";
import {
  chooseFulfilmentBranch, quoteDelivery, roadDistanceKm, validateBands,
  type BasketLine, type DeliveryBand, type DeliveryQuote, type GeoPoint, type StockIndex,
} from "../../lib/delivery-pricing";
import { requireSession } from "./auth";
import { getDb } from "./db";
import { json } from "./http";

const admins = ["ADMIN", "SUPER_ADMIN"] as const;

export type DeliverySettings = {
  enabled: boolean;
  freeDeliveryThreshold: number | null;
  maxRadiusKm: number | null;
  outsideCoverage: "BLOCK" | "CUSTOM_FEE";
  outsideFee: number | null;
  detourFactor: number;
  useRoadDistance: boolean;
  fallbackFee: number;
};

function optionalNumber(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function bandFromRow(row: typeof deliveryBands.$inferSelect): DeliveryBand {
  return {
    id: row.id,
    label: row.label,
    minKm: Number(row.minKm),
    maxKm: Number(row.maxKm),
    fee: Number(row.fee),
    freeAboveSubtotal: optionalNumber(row.freeAboveSubtotal),
    freeDeliveryEligible: row.freeDeliveryEligible,
    courier: row.courier,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
  };
}

export async function loadDeliveryConfiguration() {
  const db = getDb();
  const [[settings], bandRows] = await Promise.all([
    db.select().from(siteSettings).limit(1),
    db.select().from(deliveryBands).orderBy(asc(deliveryBands.displayOrder), asc(deliveryBands.minKm)),
  ]);
  const configuration: DeliverySettings = {
    enabled: Boolean(settings?.deliveryPricingEnabled),
    freeDeliveryThreshold: optionalNumber(settings?.freeDeliveryThreshold),
    maxRadiusKm: optionalNumber(settings?.deliveryMaxRadiusKm),
    outsideCoverage: settings?.deliveryOutsideCoverage ?? "BLOCK",
    outsideFee: optionalNumber(settings?.deliveryOutsideFee),
    detourFactor: optionalNumber(settings?.deliveryDetourFactor) ?? 1.3,
    useRoadDistance: settings?.deliveryUseRoadDistance ?? true,
    fallbackFee: optionalNumber(settings?.deliveryFallbackFee) ?? 250,
  };
  return { settings: configuration, bands: bandRows.map(bandFromRow) };
}

export function googleMapsConfigured() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

/**
 * Routed driving distance from Google, in kilometres.
 *
 * Uses the Routes API rather than the older Distance Matrix endpoint: Google no longer
 * enables the legacy one on new projects, so a fresh key silently answers every request
 * with REQUEST_DENIED and every order quietly falls back to straight-line pricing.
 *
 * Returns null on any failure — no key, quota exhausted, no route, network down — and
 * the caller then prices from the padded straight line rather than failing the
 * checkout. A customer must never be blocked from paying because a third party is
 * briefly unreachable.
 */
export async function googleRoute(from: GeoPoint, to: GeoPoint): Promise<{ km: number; minutes: number | null } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // Billed by the fields requested, so this asks for the distance and nothing else.
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.latitude, longitude: from.longitude } } },
        destination: { location: { latLng: { latitude: to.latitude, longitude: to.longitude } } },
        travelMode: "DRIVE",
        // Live traffic would make the same order cost different amounts minute to
        // minute; the fee is meant to reflect the distance, not the time of day.
        routingPreference: "TRAFFIC_UNAWARE",
        units: "METRIC",
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      console.warn("Google Routes rejected a delivery distance request", { status: response.status, detail: (await response.text().catch(() => "")).slice(0, 300) });
      return null;
    }
    const payload = await response.json() as { routes?: Array<{ distanceMeters?: number; duration?: string }> };
    const route = payload.routes?.[0];
    if (typeof route?.distanceMeters !== "number") return null;
    // Duration arrives as a protobuf duration string, "1152s".
    const seconds = Number(String(route.duration ?? "").replace(/s$/, ""));
    return {
      km: Math.round((route.distanceMeters / 1000) * 100) / 100,
      minutes: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : null,
    };
  } catch {
    return null;
  }
}

export type FulfilmentQuote = {
  quote: DeliveryQuote;
  branch: { id: number; name: string } | null;
  fullyStocked: boolean;
  /** True when the distance came from Google rather than the padded straight line. */
  routed: boolean;
  /** Driving time from the fulfilling branch, when Google supplied one. */
  durationMinutes: number | null;
  /** Set when pricing could not run at all and the flat fallback fee was used. */
  fallbackReason: string | null;
};

/**
 * Prices a delivery end to end: nearest suitable branch, distance, band, free rule.
 *
 * This is the single entry point used by both the live checkout preview and the order
 * mutation that actually charges, so a customer can never be shown one fee and billed
 * another. When distance pricing is switched off, or the shop has no pinned branches,
 * it degrades to the configured flat fee instead of refusing the order.
 */
export async function resolveDeliveryQuote(input: {
  point: GeoPoint | null;
  lines: BasketLine[];
  subtotal: number;
  preferredBranchId?: number | null;
}): Promise<FulfilmentQuote> {
  const { settings, bands } = await loadDeliveryConfiguration();
  const flat = (reason: string): FulfilmentQuote => ({
    quote: {
      available: true,
      fee: settings.fallbackFee,
      free: settings.fallbackFee === 0,
      distanceKm: 0,
      band: null,
      courier: null,
      freeAboveSubtotal: settings.freeDeliveryThreshold,
      message: settings.fallbackFee === 0 ? "Delivery: FREE" : `Delivery: KSh ${settings.fallbackFee.toLocaleString()}`,
    },
    branch: null,
    fullyStocked: false,
    routed: false,
    durationMinutes: null,
    fallbackReason: reason,
  });
  if (!settings.enabled) return flat("Distance pricing is switched off.");
  if (!input.point) return flat("No delivery location was pinned.");

  const db = getDb();
  const branchRows = await db
    .select({ id: branches.id, name: branches.name, latitude: branches.latitude, longitude: branches.longitude, isActive: branches.isActive })
    .from(branches)
    .where(eq(branches.isActive, true));
  const pinned = branchRows
    .filter((row) => row.latitude !== null && row.longitude !== null)
    .map((row) => ({ id: row.id, name: row.name, latitude: Number(row.latitude), longitude: Number(row.longitude), isActive: row.isActive }));
  if (!pinned.length) return flat("No branch has a saved map location yet.");

  const productIds = [...new Set(input.lines.map((line) => line.productId))];
  const stock: StockIndex = new Map();
  if (productIds.length) {
    const rows = await db
      .select({
        branchId: branchInventory.branchId,
        productId: branchInventory.productId,
        available: sql<number>`greatest(${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}, 0)`,
      })
      .from(branchInventory)
      .where(inArray(branchInventory.productId, productIds));
    for (const row of rows) {
      const held = stock.get(row.branchId) ?? new Map<number, number>();
      held.set(row.productId, Number(row.available));
      stock.set(row.branchId, held);
    }
  }

  const chosen = chooseFulfilmentBranch({
    branches: pinned,
    point: input.point,
    lines: input.lines,
    stock,
    preferredBranchId: input.preferredBranchId ?? null,
    detourFactor: settings.detourFactor,
  });
  if (!chosen) return flat("No branch could be matched to this location.");

  const origin = { latitude: chosen.branch.latitude as number, longitude: chosen.branch.longitude as number };
  const routed = settings.useRoadDistance ? await googleRoute(origin, input.point) : null;
  const distanceKm = routed?.km ?? roadDistanceKm(origin, input.point, settings.detourFactor);

  return {
    quote: quoteDelivery({
      distanceKm,
      subtotal: input.subtotal,
      bands,
      freeDeliveryThreshold: settings.freeDeliveryThreshold,
      maxRadiusKm: settings.maxRadiusKm,
      outsideCoverage: { mode: settings.outsideCoverage, fee: settings.outsideFee },
    }),
    branch: { id: chosen.branch.id, name: chosen.branch.name },
    fullyStocked: chosen.fullyStocked,
    routed: routed !== null,
    durationMinutes: routed?.minutes ?? null,
    fallbackReason: null,
  };
}

/**
 * Re-prices a delivery after staff move the order to a different serving store.
 *
 * The customer pinned one location, but the leg that is actually driven starts wherever
 * the order is packed. An unpaid order is re-quoted outright; a paid one only has its
 * distance and branch recorded, because rewriting a total someone has already paid
 * would be a silent overcharge. Staff then see the difference and settle it deliberately.
 */
export async function repriceDeliveryForBranch(orderId: number, branchId: number | null) {
  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.fulfilmentMethod !== "DELIVERY") return null;
  if (!order.deliveryLatitude || !order.deliveryLongitude) return null;
  const lines = await db
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const resolved = await resolveDeliveryQuote({
    point: { latitude: Number(order.deliveryLatitude), longitude: Number(order.deliveryLongitude) },
    lines: lines.flatMap((line) => (line.productId ? [{ productId: line.productId, quantity: line.quantity }] : [])),
    subtotal: Number(order.subtotal),
    preferredBranchId: branchId,
  });
  const previousFee = Number(order.deliveryFee);
  const fee = resolved.quote.available ? resolved.quote.fee : previousFee;
  const repriced = order.paymentStatus !== "PAID";
  await db.update(orders).set({
    suggestedBranchId: resolved.branch?.id ?? order.suggestedBranchId,
    deliveryDistanceKm: resolved.quote.distanceKm.toFixed(2),
    deliveryDurationMinutes: resolved.durationMinutes,
    deliveryBandId: resolved.quote.band?.id ?? null,
    deliveryCourier: resolved.quote.courier ?? null,
    ...(repriced
      ? {
          deliveryFee: fee.toFixed(2),
          total: (Number(order.subtotal) - Number(order.discount) + fee).toFixed(2),
        }
      : {}),
  }).where(eq(orders.id, orderId));
  return { repriced, fee, previousFee, distanceKm: resolved.quote.distanceKm, branch: resolved.branch };
}

const pointSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

/**
 * Live checkout preview. Deliberately returns the same shape the order mutation later
 * recalculates, so the customer sees the fee before committing to pay it.
 */
export async function handleDeliveryQuote(request: Request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z
    .object({
      latitude: pointSchema.shape.latitude.nullable().optional(),
      longitude: pointSchema.shape.longitude.nullable().optional(),
      subtotal: z.coerce.number().nonnegative().default(0),
      items: z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive() })).max(100).default([]),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Check the delivery location." }, { status: 400 });
  const point = parsed.data.latitude !== null && parsed.data.latitude !== undefined && parsed.data.longitude !== null && parsed.data.longitude !== undefined
    ? { latitude: parsed.data.latitude, longitude: parsed.data.longitude }
    : null;
  const resolved = await resolveDeliveryQuote({ point, lines: parsed.data.items, subtotal: parsed.data.subtotal });
  return json({
    available: resolved.quote.available,
    fee: resolved.quote.fee,
    free: resolved.quote.free,
    distanceKm: resolved.quote.distanceKm,
    durationMinutes: resolved.durationMinutes,
    message: resolved.quote.message,
    bandLabel: resolved.quote.band?.label ?? null,
    courier: resolved.quote.courier,
    freeAboveSubtotal: resolved.quote.freeAboveSubtotal,
    branchName: resolved.branch?.name ?? null,
    fullyStocked: resolved.fullyStocked,
    requiresLocation: !point,
  });
}

const bandSchema = z.object({
  label: z.string().trim().min(1).max(120),
  minKm: z.coerce.number().min(0).max(9999),
  maxKm: z.coerce.number().min(0).max(9999),
  fee: z.coerce.number().min(0).max(999999),
  freeAboveSubtotal: z.coerce.number().min(0).max(9999999).nullable().optional(),
  freeDeliveryEligible: z.boolean().optional(),
  courier: z.string().trim().max(120).nullable().optional(),
  displayOrder: z.coerce.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

async function rejectOverlap(candidate: { id?: number; minKm: number; maxKm: number; isActive: boolean }) {
  const rows = await getDb().select().from(deliveryBands);
  const merged = rows
    .filter((row) => row.id !== candidate.id)
    .map((row) => ({ minKm: Number(row.minKm), maxKm: Number(row.maxKm), isActive: row.isActive }))
    .concat({ minKm: candidate.minKm, maxKm: candidate.maxKm, isActive: candidate.isActive });
  return validateBands(merged);
}

/** Admin CRUD for the distance bands, plus the drag-to-reorder save. */
export async function handleDeliveryBands(request: Request, id?: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const db = getDb();

  if (request.method === "GET" && !id) {
    const rows = await db.select().from(deliveryBands).orderBy(asc(deliveryBands.displayOrder), asc(deliveryBands.minKm));
    return json({ bands: rows.map(bandFromRow) });
  }

  if (request.method === "POST" && !id) {
    const payload = await request.json().catch(() => null);
    // A reorder posts only the new sequence; it never touches distances or fees.
    const reorder = z.object({ order: z.array(z.coerce.number().int().positive()).min(1).max(200) }).safeParse(payload);
    if (reorder.success) {
      await db.transaction(async (tx) => {
        for (const [index, bandId] of reorder.data.order.entries()) {
          await tx.update(deliveryBands).set({ displayOrder: index + 1 }).where(eq(deliveryBands.id, bandId));
        }
      });
      return json({ ok: true });
    }
    const parsed = bandSchema.safeParse(payload);
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the band details." }, { status: 400 });
    const overlap = await rejectOverlap({ minKm: parsed.data.minKm, maxKm: parsed.data.maxKm, isActive: parsed.data.isActive ?? true });
    if (overlap) return json({ error: overlap }, { status: 409 });
    const [{ nextOrder }] = await db.select({ nextOrder: sql<number>`coalesce(max(${deliveryBands.displayOrder}), 0) + 1` }).from(deliveryBands);
    const [created] = await db.insert(deliveryBands).values({
      label: parsed.data.label,
      minKm: parsed.data.minKm.toFixed(2),
      maxKm: parsed.data.maxKm.toFixed(2),
      fee: parsed.data.fee.toFixed(2),
      freeAboveSubtotal: parsed.data.freeAboveSubtotal?.toFixed(2) ?? null,
      freeDeliveryEligible: parsed.data.freeDeliveryEligible ?? true,
      courier: parsed.data.courier || null,
      displayOrder: parsed.data.displayOrder ?? Number(nextOrder),
      isActive: parsed.data.isActive ?? true,
    });
    return json({ id: created.insertId }, { status: 201 });
  }

  if (request.method === "PATCH" && id) {
    const parsed = bandSchema.partial().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the band details." }, { status: 400 });
    const [existing] = await db.select().from(deliveryBands).where(eq(deliveryBands.id, id)).limit(1);
    if (!existing) return json({ error: "That distance band no longer exists." }, { status: 404 });
    const minKm = parsed.data.minKm ?? Number(existing.minKm);
    const maxKm = parsed.data.maxKm ?? Number(existing.maxKm);
    const isActive = parsed.data.isActive ?? existing.isActive;
    const overlap = await rejectOverlap({ id, minKm, maxKm, isActive });
    if (overlap) return json({ error: overlap }, { status: 409 });
    await db.update(deliveryBands).set({
      label: parsed.data.label ?? undefined,
      minKm: parsed.data.minKm === undefined ? undefined : parsed.data.minKm.toFixed(2),
      maxKm: parsed.data.maxKm === undefined ? undefined : parsed.data.maxKm.toFixed(2),
      fee: parsed.data.fee === undefined ? undefined : parsed.data.fee.toFixed(2),
      freeAboveSubtotal: parsed.data.freeAboveSubtotal === undefined ? undefined : parsed.data.freeAboveSubtotal?.toFixed(2) ?? null,
      freeDeliveryEligible: parsed.data.freeDeliveryEligible ?? undefined,
      courier: parsed.data.courier === undefined ? undefined : parsed.data.courier || null,
      displayOrder: parsed.data.displayOrder ?? undefined,
      isActive: parsed.data.isActive ?? undefined,
    }).where(eq(deliveryBands.id, id));
    return json({ ok: true });
  }

  if (request.method === "DELETE" && id) {
    // Orders keep a reference to the band they were priced by, so the row is only
    // removed when nothing points at it; otherwise it is deactivated instead.
    try {
      await db.delete(deliveryBands).where(eq(deliveryBands.id, id));
      return json({ ok: true, deleted: true });
    } catch {
      await db.update(deliveryBands).set({ isActive: false }).where(eq(deliveryBands.id, id));
      return json({ ok: true, deleted: false, message: "This band has priced past orders, so it was deactivated rather than deleted." });
    }
  }

  return json({ error: "Method not allowed." }, { status: 405 });
}

/**
 * Shop-wide delivery rules.
 *
 * Deliberately separate from the main settings endpoint: that one saves the whole
 * settings object at once, so folding delivery into it would mean the delivery screen
 * had to round-trip every unrelated field and risk clobbering them.
 */
export async function handleDeliverySettings(request: Request) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method !== "PATCH") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    deliveryPricingEnabled: z.boolean(),
    freeDeliveryThreshold: z.coerce.number().min(0).max(9999999).nullable(),
    deliveryMaxRadiusKm: z.coerce.number().min(0).max(9999).nullable(),
    deliveryOutsideCoverage: z.enum(["BLOCK", "CUSTOM_FEE"]),
    deliveryOutsideFee: z.coerce.number().min(0).max(999999).nullable(),
    deliveryDetourFactor: z.coerce.number().min(1).max(3),
    deliveryUseRoadDistance: z.boolean(),
    deliveryFallbackFee: z.coerce.number().min(0).max(999999),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the delivery rules." }, { status: 400 });
  if (parsed.data.deliveryOutsideCoverage === "CUSTOM_FEE" && parsed.data.deliveryOutsideFee === null) {
    return json({ error: "Set the fee charged outside the configured bands, or switch back to refusing those orders." }, { status: 400 });
  }
  const db = getDb();
  const values = {
    deliveryPricingEnabled: parsed.data.deliveryPricingEnabled,
    freeDeliveryThreshold: parsed.data.freeDeliveryThreshold?.toFixed(2) ?? null,
    deliveryMaxRadiusKm: parsed.data.deliveryMaxRadiusKm?.toFixed(2) ?? null,
    deliveryOutsideCoverage: parsed.data.deliveryOutsideCoverage,
    deliveryOutsideFee: parsed.data.deliveryOutsideFee?.toFixed(2) ?? null,
    deliveryDetourFactor: parsed.data.deliveryDetourFactor.toFixed(2),
    deliveryUseRoadDistance: parsed.data.deliveryUseRoadDistance,
    deliveryFallbackFee: parsed.data.deliveryFallbackFee.toFixed(2),
    updatedBy: auth.session.userId,
  };
  const [existing] = await db.select({ id: siteSettings.id }).from(siteSettings).limit(1);
  if (existing) await db.update(siteSettings).set(values).where(eq(siteSettings.id, existing.id));
  else await db.insert(siteSettings).values(values);
  return json({ ok: true });
}

/** Admin-facing preview: what would a customer at this pin be charged right now? */
export async function handleDeliveryPreview(request: Request) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = pointSchema.extend({ subtotal: z.coerce.number().nonnegative().default(0) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Pin a location to preview." }, { status: 400 });
  const resolved = await resolveDeliveryQuote({
    point: { latitude: parsed.data.latitude, longitude: parsed.data.longitude },
    lines: [],
    subtotal: parsed.data.subtotal,
  });
  return json({
    available: resolved.quote.available,
    fee: resolved.quote.fee,
    free: resolved.quote.free,
    distanceKm: resolved.quote.distanceKm,
    message: resolved.quote.message,
    bandLabel: resolved.quote.band?.label ?? null,
    courier: resolved.quote.courier,
    branchName: resolved.branch?.name ?? null,
    routed: resolved.routed,
    fallbackReason: resolved.fallbackReason,
  });
}
