/* eslint-disable @next/next/no-img-element */
import { FileText, Package, ShoppingCart, Stethoscope } from "lucide-react";
import Link from "next/link";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import {
  prescriptionStatuses,
  prescriptionStatusLabels,
  type PrescriptionStatus,
} from "@/lib/prescription-workflow";
import { PrescriptionAddButton } from "@/app/prescription-add-button";
import { AccountTabs } from "./account-tabs";
import { AccountList } from "./account-list";
import { consultationStatusLabels, type ConsultationStatus } from "@/lib/consultation-workflow";
import type { ConsultationSummary } from "./consultations/types";

export const dynamic = "force-dynamic";

type Data = {
  orders: Array<{
    id: number;
    orderNumber: string;
    createdAt: string;
    fulfilmentMethod: string;
    status: string;
    paymentStatus: string;
    total: string;
  }>;
  catalog: Array<{
    id: number;
    name: string;
    imageUrl: string | null;
    packSize: string | null;
    price: string;
    discountPrice: string | null;
    prescriptionRequired: boolean;
  }>;
  prescriptions: Array<{
    id: number;
    originalFilename: string;
    status: string;
    pharmacistNotes: string | null;
    createdAt: string;
    orderStatus: string | null;
    paymentStatus: string | null;
    orderTotal: string | null;
    items: Array<{ id: number }>;
  }>;
};

function countLabel(count: number, noun: string) {
  return count ? `${count} ${noun}${count === 1 ? "" : "s"}` : `No ${noun}s yet`;
}

function consultationLabel(status: string) {
  return consultationStatusLabels[status as ConsultationStatus] || status.replaceAll("_", " ");
}

function prescriptionLabel(status: string) {
  return prescriptionStatuses.includes(status as PrescriptionStatus)
    ? prescriptionStatusLabels[status as PrescriptionStatus]
    : status.replaceAll("_", " ");
}

export default async function AccountPage() {
  const user = await requireRole(["CUSTOMER"]);
  const [data, consultationData] = await Promise.all([
    backendJson<Partial<Data>>("/v1/views/account"),
    // A problem loading consultations should not take the whole account page down with it.
    backendJson<{ consultations: ConsultationSummary[] }>("/v1/views/consultations").catch(() => ({ consultations: [] })),
  ]);
  const orders = data.orders || [],
    prescriptions = data.prescriptions || [],
    consultations = consultationData.consultations || [],
    catalog = data.catalog || [];
  return (
    <main className="customer-account compact-account">
      {/* One line: back to the shop, the greeting, and sign out. */}
      <header className="account-topbar">
        <Link href="/#products">← Continue shopping</Link>
        <h1>Hello, {user.firstName}</h1>
        <form action="/api/auth/logout" method="post">
          <button>Sign out</button>
        </form>
      </header>
      {/* All three services are in view the moment the page opens, as tabs that stay
          pinned while the page scrolls; each jumps to its section below. */}
      <AccountTabs
        tabs={[
          { id: "orders", label: "My orders", detail: countLabel(orders.length, "order") },
          { id: "prescriptions", label: "Prescriptions", detail: countLabel(prescriptions.length, "prescription") },
          { id: "consultations", label: "My consultations", detail: countLabel(consultations.length, "consultation") },
        ]}
      />
      <section className="account-orders account-table" id="orders">
        <div>
          <h2>My orders</h2>
          <Link href="/#products">Shop more</Link>
        </div>
        <header>
          <span>Order</span>
          <span>Status</span>
          <span>Amount</span>
        </header>
        {orders.length ? (
          <AccountList noun="order">{orders.map((order) => (
            <Link href={`/account/orders/${order.id}`} key={order.id}>
              <span>
                <strong>{order.orderNumber}</strong>
                <small>
                  {new Date(order.createdAt).toLocaleDateString("en-KE")} ·{" "}
                  {order.fulfilmentMethod}
                </small>
              </span>
              <em
                className={
                  order.paymentStatus === "FAILED"
                    ? "order-payment-failed"
                    : undefined
                }
              >
                {order.paymentStatus === "FAILED"
                  ? "PAYMENT FAILED"
                  : order.status.replaceAll("_", " ")}
              </em>
              <b>KES {Number(order.total).toLocaleString()}</b>
            </Link>
          ))}</AccountList>
        ) : (
          <div className="account-empty">
            <Package />
            <span>
              <strong>No orders yet</strong>
              <small>Your orders will appear here after checkout starts.</small>
            </span>
          </div>
        )}
      </section>
      <section
        className="account-orders account-table account-prescriptions"
        id="prescriptions"
      >
        <div>
          <h2>My prescriptions</h2>
          <Link href="/prescriptions/upload">Upload another</Link>
        </div>
        <header>
          <span>Prescription</span>
          <span>Current stage</span>
          <span>Proposal</span>
        </header>
        {prescriptions.length ? (
          <AccountList noun="prescription">{prescriptions.map((request) => (
            <Link
              href={`/account/prescriptions/${request.id}`}
              key={request.id}
            >
              <span>
                <strong>{request.originalFilename}</strong>
                <small>
                  {request.status === "APPROVED" &&
                  request.orderStatus === "AWAITING_PAYMENT"
                    ? "Saved proposal ready · return whenever you choose"
                    : request.pharmacistNotes ||
                      `${request.items.length} linked ${request.items.length === 1 ? "item" : "items"}`}
                </small>
              </span>
              <em
                className={`rx-${request.status.toLowerCase().replaceAll("_", "-")}`}
              >
                {prescriptionLabel(request.status)}
              </em>
              <b>
                {request.orderTotal
                  ? `KES ${Number(request.orderTotal).toLocaleString()}`
                  : new Date(request.createdAt).toLocaleDateString("en-KE")}
              </b>
            </Link>
          ))}</AccountList>
        ) : (
          <div className="account-empty">
            <FileText />
            <span>
              <strong>No prescriptions uploaded</strong>
              <small>
                Review progress and saved proposals will appear here.
              </small>
            </span>
          </div>
        )}
      </section>
      <section className="account-orders account-table account-consultations" id="consultations">
        <div>
          <h2>My consultations</h2>
          <Link href="/prescriptions/consult">Start a consultation</Link>
        </div>
        <header>
          <span>Consultation</span>
          <span>Current stage</span>
          <span>Last update</span>
        </header>
        {consultations.length ? (
          <AccountList noun="consultation">
            {consultations.map((item) => (
              <Link href={`/account/consultations/${item.id}`} key={item.id}>
                <span>
                  <strong>{item.reference}</strong>
                  <small>{item.concern}</small>
                </span>
                <em className={`rx-status ${item.status.toLowerCase().replaceAll("_", "-")}`}>
                  {consultationLabel(item.status)}
                </em>
                <b>{new Date(item.lastMessageAt || item.createdAt).toLocaleDateString("en-KE")}</b>
              </Link>
            ))}
          </AccountList>
        ) : (
          <div className="account-empty">
            <Stethoscope />
            <span>
              <strong>No consultations yet</strong>
              <small>Describe your symptoms and a healthcare professional will review your case.</small>
            </span>
          </div>
        )}
      </section>
      <section className="account-products">
        <header>
          <div>
            <h2>Continue shopping</h2>
            <p>Your normal cart remains independent from pharmacy proposals.</p>
          </div>
          <Link href="/#products">View all</Link>
        </header>
        <div>
          {catalog.map((product) => (
            <article key={product.id}>
              <Link href={`/products/${product.id}`}>
                <div>
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} />
                  ) : (
                    <Package />
                  )}
                </div>
                <strong>{product.name}</strong>
                <small>{product.packSize || "Healthfield Pharmacy"}</small>
              </Link>
              <footer>
                <b>
                  KES{" "}
                  {Number(
                    product.discountPrice ?? product.price,
                  ).toLocaleString()}
                </b>
                {product.prescriptionRequired ? (
                  <PrescriptionAddButton
                    items={[{ id: product.id, name: product.name }]}
                    ariaLabel={`Prescription required for ${product.name}`}
                  >
                    <ShoppingCart />
                  </PrescriptionAddButton>
                ) : (
                  <form action="/api/cart" method="post">
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="action" value="add" />
                    <input type="hidden" name="return" value="/account" />
                    <button aria-label={`Add ${product.name} to cart`}>
                      <ShoppingCart />
                    </button>
                  </form>
                )}
              </footer>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
