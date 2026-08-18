"use client";

import { AlertCircle, CheckCircle2, LockKeyhole, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { lowestAllowedQuantity, selectionIsAllowed } from "@/lib/prescription-dispensing";
import type { CustomerPrescriptionItem } from "../types";

export function DispenseSelector({
  prescriptionId,
  items,
}: {
  prescriptionId: number;
  items: CustomerPrescriptionItem[];
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      items.map((item) => [item.id, item.deferred ? 0 : (item.selectedQuantity ?? Number(item.approvedQuantity) ?? 0)]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const lines = useMemo(
    () =>
      items.map((item) => ({
        item,
        rule: {
          id: item.id,
          approvedQuantity: Number(item.approvedQuantity) || 0,
          dispenseRule: item.dispenseRule,
          minimumQuantity: item.minimumQuantity,
        },
      })),
    [items],
  );

  const total = lines.reduce((sum, { item }) => sum + Number(item.unitPrice) * (choice[item.id] || 0), 0);
  const deferred = lines.filter(({ item }) => (choice[item.id] || 0) === 0).length;
  const nothingChosen = deferred === lines.length;

  function set(id: number, quantity: number) {
    setSaved(false);
    setError("");
    setChoice((current) => ({ ...current, [id]: quantity }));
  }

  async function save() {
    if (saving) return;
    if (nothingChosen) return setError("Choose at least one medicine to buy now.");
    for (const { item, rule } of lines) {
      if (!selectionIsAllowed(rule, choice[item.id] || 0)) {
        return setError(
          item.dispenseRule === "COURSE_BOUND"
            ? `${item.productName} must be bought as a full course, or left for later.`
            : `Choose between ${lowestAllowedQuantity(rule)} and ${rule.approvedQuantity} of ${item.productName}.`,
        );
      }
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/prescriptions/${prescriptionId}/selection`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: lines.map(({ item }) => ({ id: item.id, quantity: choice[item.id] || 0 })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "The selection could not be saved.");
      setSaved(true);
      router.refresh();
    } catch {
      setError("The selection could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rx-dispense">
      <header>
        <Wallet />
        <span>
          <strong>Cannot afford everything today?</strong>
          <small>
            Choose what to buy now. Anything you leave stays on your prescription, so you can come back for it later
            without another consultation.
          </small>
        </span>
      </header>

      {lines.map(({ item, rule }) => {
        const quantity = choice[item.id] || 0;
        const floor = lowestAllowedQuantity(rule);
        const courseBound = item.dispenseRule === "COURSE_BOUND";
        return (
          <article key={item.id} className={quantity === 0 ? "is-deferred" : undefined}>
            <div className="rx-dispense-line">
              <span>
                <strong>{item.productName}</strong>
                <small>
                  Prescribed {rule.approvedQuantity} · KES {Number(item.unitPrice).toLocaleString()} each
                  {item.pharmacistNote ? ` · ${item.pharmacistNote}` : ""}
                </small>
              </span>
              <b>KES {(Number(item.unitPrice) * quantity).toLocaleString()}</b>
            </div>

            <div className="rx-dispense-controls">
              <button type="button" className={quantity > 0 ? "active" : ""} onClick={() => set(item.id, rule.approvedQuantity)}>
                Buy now
              </button>
              <button type="button" className={quantity === 0 ? "active" : ""} onClick={() => set(item.id, 0)}>
                Buy later
              </button>
              {!courseBound && quantity > 0 ? (
                <label>
                  Quantity
                  <input
                    type="number"
                    min={floor}
                    max={rule.approvedQuantity}
                    value={quantity}
                    onChange={(event) => set(item.id, Number(event.target.value))}
                  />
                </label>
              ) : null}
            </div>

            {courseBound ? (
              <p className="rx-dispense-locked">
                <LockKeyhole /> This is a full course. Taking part of it can stop the treatment working, so it must be
                bought whole — or left for later.
              </p>
            ) : (
              <p className="rx-dispense-note">You may buy as few as {floor} now and the rest later.</p>
            )}
          </article>
        );
      })}

      <footer>
        <span>
          <small>{deferred ? `${deferred} left for later` : "Buying everything prescribed"}</small>
          <strong>KES {total.toLocaleString()}</strong>
        </span>
        <button type="button" onClick={save} disabled={saving || nothingChosen}>
          {saving ? "Updating…" : saved ? "Selection saved" : "Update my total"}
        </button>
      </footer>

      {error ? (
        <div className="rx-consult-message is-error" role="status">
          <AlertCircle /> {error}
        </div>
      ) : null}
      {saved && !error ? (
        <div className="rx-consult-message" role="status">
          <CheckCircle2 /> Your total has been updated. Continue to payment when you are ready.
        </div>
      ) : null}
    </section>
  );
}
