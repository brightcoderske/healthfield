"use client";

import { FormEvent, useState } from "react";

const labels = ["", "Poor", "Fair", "Good", "Very good", "Recommend"];

export function ProductReviewForm({ productId }: { productId: number }) {
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rating) return;
    setSaving(true);
    const response = await fetch(`/api/products/${productId}/reviews`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, comment: labels[rating] }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(data.message || data.error || "Review could not be saved.");
    setSaving(false);
    if (response.ok) setTimeout(() => location.reload(), 700);
  }

  return <form className="review-form compact-review-form" onSubmit={submit}>
    <h3>Rate this product</h3>
    <div className="review-stars">
      {[1,2,3,4,5].map(value => <button type="button" key={value} className={value <= rating ? "selected" : ""} onClick={() => setRating(value)} aria-label={`${value} stars`}>★</button>)}
      <strong>{rating ? labels[rating] : "Select a rating"}</strong>
    </div>
    {rating > 0 && <button disabled={saving}>{saving ? "Saving…" : `Submit ${labels[rating]} rating`}</button>}
    {message && <p>{message}</p>}
  </form>;
}
