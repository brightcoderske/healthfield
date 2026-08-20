"use client";

import { CircleAlert, CreditCard, Lock, Megaphone, MessageSquareText, RefreshCw, Smartphone, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export type SmsReportData = {
  messages: Array<{
    id: number;
    recipient: string;
    purpose: string;
    channel: "TRANSACTIONAL" | "PROMOTIONAL";
    message: string;
    segments: number;
    providerMessageId: string | null;
    status: string;
    responseCode: string | null;
    detail: string | null;
    createdAt: string;
  }>;
  last30Days: {
    byStatus: Record<string, number>;
    segmentsByChannel: Record<string, number>;
  };
  configuration: {
    configured: boolean;
    transactionalSenderId: string | null;
    promotionalSenderId: string | null;
    marketingEnabled: boolean;
    transactionalEnabled: boolean;
    dryRun: boolean;
  };
  balance: unknown;
  topUpUrl: string;
};

/**
 * Pulls a credit figure out of whatever Celcom returned.
 *
 * Their balance payload is not documented field by field, so rather than assume a shape
 * this looks for the first plausible numeric credit value and falls back to showing the
 * raw response. A wrong number here would be worse than no number.
 */
function readBalance(payload: unknown): { credit: string | null; raw: string } {
  const raw = payload === null || payload === undefined ? "" : JSON.stringify(payload);
  if (!raw || raw === "{}" || raw === "null") return { credit: null, raw: "" };
  const seek = (value: unknown, depth = 0): number | null => {
    if (depth > 4 || value === null || typeof value !== "object") return null;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/credit|balance|bal|amount/i.test(key)) {
        const numeric = Number(String(entry).replace(/[^0-9.-]/g, ""));
        if (Number.isFinite(numeric)) return numeric;
      }
    }
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const nested = seek(entry, depth + 1);
      if (nested !== null) return nested;
    }
    return null;
  };
  const credit = seek(payload);
  return { credit: credit === null ? null : credit.toLocaleString(), raw };
}

const STATUS_LABELS: Record<string, string> = {
  DELIVERED: "Delivered",
  SENT: "Sent",
  PENDING: "Pending",
  FAILED: "Failed",
  UNDELIVERED: "Not delivered",
};

export function SmsReports({ data }: { data: SmsReportData }) {
  const messages = data.messages;
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [channel, setChannel] = useState<"ALL" | "TRANSACTIONAL" | "PROMOTIONAL">("ALL");

  const balance = useMemo(() => readBalance(data.balance), [data.balance]);
  const shown = useMemo(
    () => (channel === "ALL" ? messages : messages.filter((row) => row.channel === channel)),
    [messages, channel],
  );
  const totals = data.last30Days.byStatus;
  const segments = data.last30Days.segmentsByChannel;
  const totalSegments = Object.values(segments).reduce((sum, value) => sum + value, 0);

  async function refresh() {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch("/api/sms/refresh-reports", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return setNotice(result.error || "Delivery reports could not be refreshed.");
      setNotice(`Checked ${result.checked ?? 0} message${result.checked === 1 ? "" : "s"}; ${result.updated ?? 0} updated. Reload to see the new statuses.`);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="compact-admin-page sms-admin">
      <header>
        <div>
          <Link href="/admin">← Dashboard</Link>
          <h1>Bulk SMS reports</h1>
          <p>
            Every message the system has sent, with what Celcom said about it. Credentials
            live in the API environment and are never shown or edited here.
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing || !data.configuration.configured}>
          <RefreshCw /> {refreshing ? "Checking…" : "Refresh delivery reports"}
        </button>
      </header>

      {notice ? <div className="admin-notice" role="status">{notice}</div> : null}
      {!data.configuration.configured ? (
        <div className="delivery-warning" role="status">
          <CircleAlert />
          <span>
            Bulk SMS is not configured. Add the Celcom API key, partner ID and sender IDs to
            the API service environment; nothing is sent until then.
          </span>
        </div>
      ) : null}
      {data.configuration.dryRun ? (
        <div className="delivery-warning" role="status">
          <CircleAlert />
          <span>Dry run is on. Messages are logged here but never actually delivered.</span>
        </div>
      ) : null}

      {/* Promotional sending lives in Campaigns; this is the way in. It stays inert
          until Celcom has issued the promotional sender ID, because a send attempted
          without one is refused by the gateway with code 1001 rather than queued. */}
      <section className={`sms-promo-shortcut ${data.configuration.promotionalSenderId ? "" : "locked"}`}>
        <div>
          <strong><Megaphone /> Send a promotional message</strong>
          <small>
            {data.configuration.promotionalSenderId
              ? `Goes out to your customer list under the ${data.configuration.promotionalSenderId} sender ID, with an opt-out added automatically.`
              : "Available once Celcom issues and approves your promotional sender ID."}
          </small>
        </div>
        {data.configuration.promotionalSenderId ? (
          <Link href="/admin/campaigns">New campaign</Link>
        ) : (
          <span className="sms-promo-locked"><Lock /> Awaiting sender ID</span>
        )}
      </section>

      <section className="sms-cards">
        <article className="sms-card sms-card-balance">
          <span className="sms-card-label"><Wallet /> Remaining credit</span>
          <strong>{balance.credit ?? (balance.raw ? "See raw response" : "Unavailable")}</strong>
          {balance.credit === null && balance.raw ? <code>{balance.raw.slice(0, 160)}</code> : null}
          <a href={data.topUpUrl} target="_blank" rel="noreferrer" className="sms-topup">
            <CreditCard /> Recharge credits
          </a>
        </article>
        <article className="sms-card">
          <span className="sms-card-label"><Smartphone /> How to recharge</span>
          <small>Paybill<b>2007272</b></small>
          <small>Account<b>Healthfield</b></small>
          <small>Credit appears here once Celcom confirms the payment.</small>
        </article>
        <article className="sms-card">
          <span className="sms-card-label"><MessageSquareText /> Last 30 days</span>
          <strong>{totalSegments.toLocaleString()} segments</strong>
          <small>
            {(segments.TRANSACTIONAL ?? 0).toLocaleString()} transactional ·{" "}
            {(segments.PROMOTIONAL ?? 0).toLocaleString()} promotional
          </small>
          <small>A long message counts as more than one segment, and is billed that way.</small>
        </article>
        <article className="sms-card">
          <span className="sms-card-label">Delivery, last 30 days</span>
          <div className="sms-status-grid">
            {["DELIVERED", "SENT", "PENDING", "UNDELIVERED", "FAILED"].map((status) => (
              <span key={status}>
                <b>{(totals[status] ?? 0).toLocaleString()}</b>
                {STATUS_LABELS[status]}
              </span>
            ))}
          </div>
        </article>
        <article className="sms-card">
          <span className="sms-card-label">Sender IDs</span>
          <small>Transactional<b>{data.configuration.transactionalSenderId || "not set"}</b></small>
          <small>Promotional<b>{data.configuration.promotionalSenderId || "not set"}</b></small>
          <small>
            {data.configuration.transactionalEnabled ? "Transactional on" : "Transactional paused"} ·{" "}
            {data.configuration.marketingEnabled ? "marketing on" : "marketing paused"}
          </small>
        </article>
      </section>

      <div className="compact-table-tools">
        <div className="sms-filter">
          {(["ALL", "TRANSACTIONAL", "PROMOTIONAL"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={channel === option ? "active" : ""}
              onClick={() => setChannel(option)}
            >
              {option === "ALL" ? "All" : option === "TRANSACTIONAL" ? "Transactional" : "Promotional"}
            </button>
          ))}
        </div>
        <span>{shown.length} of {messages.length} shown</span>
      </div>

      <div className="compact-table">
        <div className="compact-table-head sms-row">
          <span>Sent</span>
          <span>Recipient</span>
          <span>Type</span>
          <span>Message</span>
          <span>Parts</span>
          <span>Status</span>
          <span>Provider detail</span>
        </div>
        {shown.map((row) => (
          <div className="compact-table-row sms-row" key={row.id}>
            <span>{new Date(row.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
            <b>{row.recipient}</b>
            <span>
              {row.purpose.replaceAll("_", " ").toLowerCase()}
              <small className={row.channel === "PROMOTIONAL" ? "sms-tag promo" : "sms-tag"}>
                {row.channel === "PROMOTIONAL" ? "promotional" : "transactional"}
              </small>
            </span>
            <span className="sms-message" title={row.message}>{row.message}</span>
            <span>{row.segments}</span>
            <span className={`sms-status ${row.status.toLowerCase()}`}>{STATUS_LABELS[row.status] ?? row.status}</span>
            <span className="sms-detail" title={row.detail || ""}>
              {row.detail || "—"}
              {row.responseCode ? <small>code {row.responseCode}</small> : null}
            </span>
          </div>
        ))}
        {!shown.length ? (
          <p className="compact-table-empty">
            No messages yet. They appear here as soon as the system starts sending.
          </p>
        ) : null}
      </div>
    </main>
  );
}
