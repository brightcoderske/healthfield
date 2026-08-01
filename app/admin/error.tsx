"use client";

import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="data-page" style={{ padding: 24 }}>
      <header>
        <a href="/admin">← Dashboard</a>
        <h1>Admin page unavailable</h1>
        <p>{error.message || "The API could not load this page."}</p>
      </header>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}
