"use client";

import { ArrowLeft, Check, CornerDownRight, FolderTree, Layers, Package, Pencil, Plus, Star, Stethoscope, Trash2, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

type Category = { id: number; name: string; description?: string | null; parentId?: number | null; featuredOnStorefront?: boolean };
type Condition = { id: number; name: string; description?: string | null };

const FEATURED_LIMIT = 6;

/** "Main category" is the absence of a parent, and the select needs a value for it. */
const TOP_LEVEL = "top";

function plural(count: number, word: string, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

/**
 * The categories panel: a two-level tree that can be rearranged in place.
 *
 * Products are filed against a category, never against its position in the tree, so
 * making a category a subcategory of another moves its products with it and promoting
 * it back brings them back up. Nothing has to be re-tagged, which is what makes
 * rearranging the shelf safe to do on a live shop.
 */
function CategoryPanel({ initial, productCounts }: { initial: Category[]; productCounts: Record<number, number> }) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");
  const [parent, setParent] = useState(TOP_LEVEL);
  const [featured, setFeatured] = useState(false);
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const mains = useMemo(() => items.filter((item) => !item.parentId), [items]);
  const childrenOf = useMemo(() => {
    const map = new Map<number, Category[]>();
    for (const item of items) {
      if (!item.parentId) continue;
      map.set(item.parentId, [...(map.get(item.parentId) || []), item]);
    }
    return map;
  }, [items]);
  const featuredCount = mains.filter((item) => item.featuredOnStorefront).length;
  const subCount = items.length - mains.length;
  // What a shopper reaches through this category: its own products plus everything
  // filed in the subcategories beneath it.
  const reach = (category: Category) =>
    (productCounts[category.id] || 0) +
    (childrenOf.get(category.id) || []).reduce((sum, child) => sum + (productCounts[child.id] || 0), 0);

  function report(text: string, bad = false) {
    setMessage(text);
    setFailed(bad);
  }

  async function send(id: number, payload: Record<string, unknown>, apply: (item: Category) => Category, success: string) {
    setBusy(id);
    const response = await fetch(`/api/categories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) return report(data.error || "That change could not be saved.", true);
    setItems((rows) => rows.map((row) => (row.id === id ? apply(row) : row)));
    report(success);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) return report("Give the category a name of at least two characters.", true);
    const parentId = parent === TOP_LEVEL ? null : Number(parent);
    setBusy("new");
    const response = await fetch("/api/categories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, parentId, featured: parentId === null && featured }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) return report(data.error || "That category could not be added.", true);
    setItems((rows) => [...rows, { id: data.id, name: trimmed, parentId, featuredOnStorefront: Boolean(data.featured) }]);
    setName("");
    setFeatured(false);
    report(parentId === null ? `${trimmed} added as a main category.` : `${trimmed} added under ${items.find((row) => row.id === parentId)?.name}.`);
  }

  function move(category: Category, value: string) {
    const parentId = value === TOP_LEVEL ? null : Number(value);
    if ((category.parentId ?? null) === parentId) return;
    const moved = productCounts[category.id] || 0;
    const carries = moved ? ` It takes ${plural(moved, "product")} with it.` : "";
    void send(
      category.id,
      { name: category.name, parentId },
      (item) => ({ ...item, parentId, featuredOnStorefront: parentId === null ? item.featuredOnStorefront : false }),
      parentId === null
        ? `${category.name} is now a main category.${carries}`
        : `${category.name} now sits under ${items.find((row) => row.id === parentId)?.name}.${carries}`,
    );
  }

  function toggleFeatured(category: Category) {
    const next = !category.featuredOnStorefront;
    if (next && featuredCount >= FEATURED_LIMIT) return report(`All ${FEATURED_LIMIT} storefront tiles are taken. Remove one before adding another.`, true);
    void send(category.id, { name: category.name, featured: next }, (item) => ({ ...item, featuredOnStorefront: next }), next ? `${category.name} now shows on the storefront.` : `${category.name} no longer shows on the storefront.`);
  }

  function rename(category: Category) {
    const trimmed = draftName.trim();
    if (trimmed.length < 2) return report("A category name needs at least two characters.", true);
    if (trimmed === category.name) return setEditing(null);
    void send(category.id, { name: trimmed }, (item) => ({ ...item, name: trimmed }), `Renamed to ${trimmed}.`);
    setEditing(null);
  }

  async function remove(category: Category) {
    const held = reach(category);
    const warning = held
      ? `Remove ${category.name}? ${plural(held, "product")} filed here will stay in the catalogue but will no longer be reachable through this category.`
      : `Remove ${category.name}?`;
    if (!window.confirm(warning)) return;
    setBusy(category.id);
    const response = await fetch(`/api/categories/${category.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) return report(data.error || "That category could not be removed.", true);
    setItems((rows) => rows.filter((row) => row.id !== category.id));
    report(`${category.name} removed.`);
  }

  // Written as a plain function, not a nested component: a component declared during
  // render is a new type every render, and React would remount it on each keystroke and
  // throw the caret out of the rename box.
  function row(category: Category, child: boolean) {
    const own = productCounts[category.id] || 0;
    const total = reach(category);
    const options = mains.filter((main) => main.id !== category.id);
    // A main category that holds subcategories cannot itself be filed under another one
    // without making the tree three deep. The server refuses it; saying so here means
    // nobody has to trigger the refusal to find out.
    const holdsChildren = !child && Boolean(childrenOf.get(category.id)?.length);
    return <article key={category.id} className={child ? "tree-row is-child" : "tree-row"} aria-busy={busy === category.id}>
      <span className="tree-name">
        {child ? <CornerDownRight className="tree-branch" aria-hidden="true" /> : <FolderTree className="tree-branch" aria-hidden="true" />}
        {editing === category.id ? (
          <span className="tree-rename">
            <input value={draftName} autoFocus onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") rename(category); if (event.key === "Escape") setEditing(null); }}
              aria-label={`Rename ${category.name}`} />
            <button type="button" className="tree-confirm" onClick={() => rename(category)} aria-label="Save name"><Check /></button>
            <button type="button" onClick={() => setEditing(null)} aria-label="Cancel rename"><X /></button>
          </span>
        ) : (
          <span className="tree-label">
            <b>{category.name}</b>
            <small>
              <Package aria-hidden="true" />
              {plural(own, "product")}
              {!child && total > own ? ` · ${total} including subcategories` : ""}
              {!child && childrenOf.get(category.id)?.length ? ` · ${plural(childrenOf.get(category.id)!.length, "subcategory", "subcategories")}` : ""}
            </small>
          </span>
        )}
      </span>

      <span className="tree-place">
        <label>
          <span className="visually-hidden">Where {category.name} sits</span>
          <select value={category.parentId ? String(category.parentId) : TOP_LEVEL} disabled={busy !== null} onChange={(event) => move(category, event.target.value)}>
            <option value={TOP_LEVEL}>Main category</option>
            {options.map((main) => <option key={main.id} value={main.id} disabled={holdsChildren}>Under {main.name}</option>)}
          </select>
        </label>
        {holdsChildren ? <small className="tree-place-note">Move its subcategories out first</small> : null}
      </span>

      <span className="tree-featured">
        {child ? (
          <small className="tree-featured-na">Shown under its main category</small>
        ) : (
          <button type="button" className={category.featuredOnStorefront ? "tree-star is-on" : "tree-star"}
            disabled={busy !== null || (!category.featuredOnStorefront && featuredCount >= FEATURED_LIMIT)}
            aria-pressed={Boolean(category.featuredOnStorefront)}
            onClick={() => toggleFeatured(category)}>
            <Star /> {category.featuredOnStorefront ? "On storefront" : "Not shown"}
          </button>
        )}
      </span>

      <span className="tree-actions">
        <button type="button" onClick={() => { setEditing(category.id); setDraftName(category.name); }} aria-label={`Rename ${category.name}`}><Pencil /></button>
        <button type="button" className="tree-delete" onClick={() => remove(category)} aria-label={`Remove ${category.name}`}><Trash2 /></button>
      </span>
    </article>;
  }

  return <section className="taxonomy-panel">
    <header>
      <span className="taxonomy-panel-title"><Layers aria-hidden="true" /><h2>Product categories</h2></span>
      <small>{plural(mains.length, "main category", "main categories")} · {plural(subCount, "subcategory", "subcategories")}</small>
    </header>
    <p className="taxonomy-lead">
      Categories are two levels deep: a main category and the subcategories filed under it.
      Moving a category takes its products with it, so nothing has to be re-tagged.
    </p>

    <form className="taxonomy-add" onSubmit={add}>
      <label>
        <span>New category</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Cough and cold" maxLength={150} required />
      </label>
      <label>
        <span>Place it</span>
        <select value={parent} onChange={(event) => { setParent(event.target.value); if (event.target.value !== TOP_LEVEL) setFeatured(false); }}>
          <option value={TOP_LEVEL}>As a main category</option>
          {mains.map((main) => <option key={main.id} value={main.id}>Under {main.name}</option>)}
        </select>
      </label>
      <label className="taxonomy-add-featured">
        <input type="checkbox" checked={featured} disabled={parent !== TOP_LEVEL || featuredCount >= FEATURED_LIMIT} onChange={(event) => setFeatured(event.target.checked)} />
        <span>Show on storefront</span>
      </label>
      <button type="submit" disabled={busy !== null}><Plus /> {busy === "new" ? "Adding…" : "Add category"}</button>
    </form>

    <p className="taxonomy-slots">
      <Star aria-hidden="true" />
      {featuredCount} of {FEATURED_LIMIT} storefront tiles used.
      {featuredCount >= FEATURED_LIMIT ? " Remove one to feature a different category." : " Only main categories can take a tile."}
    </p>
    {message ? <p className={failed ? "taxonomy-message is-error" : "taxonomy-message"} role="status">{message}</p> : null}

    <div className="taxonomy-tree">
      <div className="taxonomy-tree-head"><span>Category</span><span>Placement</span><span>Storefront</span><span>Actions</span></div>
      {mains.length ? mains.map((main) => (
        <div className="tree-group" key={main.id}>
          {row(main, false)}
          {(childrenOf.get(main.id) || []).map((child) => row(child, true))}
        </div>
      )) : <div className="taxonomy-empty"><FolderTree /><strong>No categories yet</strong><span>Add a main category to start arranging the shelf.</span></div>}
    </div>
  </section>;
}

/** Conditions are a flat, cross-cutting tag: a product can serve several at once. */
function ConditionPanel({ initial, counts }: { initial: Condition[]; counts: Record<number, number> }) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/conditions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), description: description.trim() }) });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setFailed(true); return setMessage(data.error || "That condition could not be added."); }
    setItems((rows) => [...rows, { id: data.id, name: name.trim(), description: description.trim() }]);
    setName(""); setDescription(""); setFailed(false); setMessage(`${data.name} added.`);
  }

  async function rename(item: Condition) {
    const next = window.prompt("Rename condition", item.name);
    if (!next?.trim()) return;
    const response = await fetch(`/api/conditions/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: next.trim(), description: item.description || "" }) });
    if (response.ok) setItems((rows) => rows.map((row) => (row.id === item.id ? { ...row, name: next.trim() } : row)));
  }

  async function remove(item: Condition) {
    if (!window.confirm(`Remove ${item.name}? Products tagged with it keep their other tags.`)) return;
    const response = await fetch(`/api/conditions/${item.id}`, { method: "DELETE" });
    if (response.ok) setItems((rows) => rows.filter((row) => row.id !== item.id));
  }

  return <section className="taxonomy-panel">
    <header>
      <span className="taxonomy-panel-title"><Stethoscope aria-hidden="true" /><h2>Health conditions</h2></span>
      <small>{plural(items.length, "condition")}</small>
    </header>
    <p className="taxonomy-lead">What a product is <em>for</em>, rather than what it is. A product can carry several, so these stay a flat list.</p>
    <form className="taxonomy-add is-condition" onSubmit={add}>
      <label><span>New condition</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Diabetes" maxLength={150} required /></label>
      <label><span>Short note</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" maxLength={500} /></label>
      <button type="submit" disabled={busy}><Plus /> {busy ? "Adding…" : "Add"}</button>
    </form>
    {message ? <p className={failed ? "taxonomy-message is-error" : "taxonomy-message"} role="status">{message}</p> : null}
    <div className="taxonomy-tree">
      <div className="taxonomy-tree-head is-condition"><span>Condition</span><span>Products</span><span>Actions</span></div>
      {items.map((item) => <article className="tree-row is-condition" key={item.id}>
        <span className="tree-name"><span className="tree-label"><b>{item.name}</b>{item.description ? <small>{item.description}</small> : null}</span></span>
        <span className="tree-count"><Package aria-hidden="true" />{counts[item.id] || 0}</span>
        <span className="tree-actions">
          <button type="button" onClick={() => rename(item)} aria-label={`Rename ${item.name}`}><Pencil /></button>
          <button type="button" className="tree-delete" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}><Trash2 /></button>
        </span>
      </article>)}
      {!items.length ? <div className="taxonomy-empty"><Stethoscope /><strong>No conditions yet</strong><span>Add one to let shoppers browse by what they need.</span></div> : null}
    </div>
  </section>;
}

export function TaxonomyManager({ initialCategories, initialConditions, productCounts, conditionCounts }: {
  initialCategories: Category[];
  initialConditions: Condition[];
  productCounts: Record<number, number>;
  conditionCounts: Record<number, number>;
}) {
  return <main className="taxonomy-page">
    <header className="taxonomy-header">
      <a href="/admin"><ArrowLeft /> Dashboard</a>
      <h1>Categories</h1>
      <p>How the shop is arranged: the categories customers browse, and the conditions they shop by.</p>
    </header>
    <div className="taxonomy-grid">
      <CategoryPanel initial={initialCategories} productCounts={productCounts} />
      <ConditionPanel initial={initialConditions} counts={conditionCounts} />
    </div>
  </main>;
}
