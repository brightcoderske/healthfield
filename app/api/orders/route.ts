import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import { getSession } from "@/lib/auth";

const orderSchema = z.object({
  fullName: z.string().trim().min(3).max(200),
  phone: z.string().trim().min(9).max(30),
  email: z.string().trim().email().optional().or(z.literal("")),
  fulfilmentMethod: z.enum(["DELIVERY", "PICKUP"]),
  deliveryAddress: z.string().trim().max(1000).optional(),
  deliveryArea: z.string().trim().max(160).optional(),
  deliveryLatitude: z.number().min(-90).max(90).optional(),
  deliveryLongitude: z.number().min(-180).max(180).optional(),
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).min(1),
});

export async function POST(request: Request) {
  const parsed = orderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid order." }, { status: 400 });
  const input = parsed.data;
  if (input.fulfilmentMethod === "DELIVERY" && !input.deliveryAddress) {
    return NextResponse.json({ error: "Delivery address is required." }, { status: 400 });
  }

  const db = getDb();
  const catalog = await db.select().from(products).where(inArray(products.id, input.items.map((item) => item.productId)));
  if (catalog.length !== new Set(input.items.map((item) => item.productId)).size) {
    return NextResponse.json({ error: "One or more products are unavailable." }, { status: 409 });
  }
  const lines = input.items.map((item) => {
    const product = catalog.find((entry) => entry.id === item.productId)!;
    const price = Number(product.discountPrice ?? product.price);
    return { ...item, product, price, total: price * item.quantity };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const deliveryFee = input.fulfilmentMethod === "DELIVERY" ? 250 : 0;
  const session = await getSession();
  const orderNumber = `HF-${Date.now().toString().slice(-8)}`;

  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(orders).values({
      orderNumber,
      customerId: session?.role === "CUSTOMER" ? session.userId : null,
      customerName: input.fullName,
      phone: input.phone,
      email: input.email || null,
      fulfilmentMethod: input.fulfilmentMethod,
      deliveryAddress: input.deliveryAddress || null,
      deliveryArea: input.deliveryArea || null,
      deliveryLatitude: input.deliveryLatitude?.toString() || null,
      deliveryLongitude: input.deliveryLongitude?.toString() || null,
      subtotal: subtotal.toString(),
      deliveryFee: deliveryFee.toString(),
      discount: "0",
      total: (subtotal + deliveryFee).toString(),
    });
    await tx.insert(orderItems).values(lines.map((line) => ({
      orderId: created.insertId,
      productId: line.product.id,
      productName: line.product.name,
      quantity: line.quantity,
      unitPrice: line.price.toString(),
      lineTotal: line.total.toString(),
    })));
    return created.insertId;
  });
  return NextResponse.json({ ok: true, orderId: result, orderNumber, total: subtotal + deliveryFee }, { status: 201 });
}
