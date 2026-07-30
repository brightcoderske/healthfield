import { asc, eq } from "drizzle-orm";
import Image from "next/image";
import { getDb } from "@/db";
import { healthConditions } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function ConditionsPage() {
  const conditions = await getDb()
    .select()
    .from(healthConditions)
    .where(eq(healthConditions.isActive, true))
    .orderBy(asc(healthConditions.displayOrder), asc(healthConditions.name));

  return (
    <main className="conditions-page">
      <header>
        <a href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={210} height={76} priority /></a>
        <a href="/">← Continue shopping</a>
      </header>
      <section>
        <span>Healthfield product guide</span>
        <h1>Shop by health condition</h1>
        <p>Select a condition to view matching products in the Healthfield catalogue.</p>
        <div>
          {conditions.map((condition) => (
            <a key={condition.id} href={`/?condition=${condition.slug}#products`}>
              <strong>{condition.name}</strong>
              {condition.description && <small>{condition.description}</small>}
              <b>View products →</b>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
