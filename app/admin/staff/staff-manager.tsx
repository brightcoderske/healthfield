"use client";

import { FormEvent, useMemo, useState } from "react";
import { Plus, Search, ShieldCheck, Trash2, UserRound, X } from "lucide-react";

type Store = { id: number; name: string };
type Staff = { id: number; firstName: string; lastName: string; email: string; phone: string | null; role: "STAFF" | "ADMIN" | "SUPER_ADMIN"; homeBranchId: number | null; isActive: boolean; twoFactorEnabled: boolean };

export function StaffManager({ initialStaff, stores, canManageAdmins }: { initialStaff: Staff[]; stores: Store[]; canManageAdmins: boolean }) {
  const [rows, setRows] = useState(initialStaff);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [selectedRole, setSelectedRole] = useState<"STAFF" | "ADMIN">("STAFF");
  const [saving, setSaving] = useState<number | "new" | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const shown = useMemo(() => rows.filter((row) => `${row.firstName} ${row.lastName} ${row.email}`.toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const current = editing === "new" ? null : editing;

  function openEditor(staff: Staff | "new") {
    setSelectedRole(staff === "new" || staff.role !== "ADMIN" ? "STAFF" : "ADMIN");
    setEditing(staff);
    setConfirmDelete(false);
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const payload = { firstName: String(form.get("firstName")), lastName: String(form.get("lastName")), email: String(form.get("email")), phone: String(form.get("phone") || ""), role: String(form.get("role")), homeBranchId: form.get("homeBranchId") ? Number(form.get("homeBranchId")) : null, password: String(form.get("password") || "") || undefined, isActive: form.get("isActive") === "on" };
    const isNew = editing === "new", id = isNew ? "new" : editing.id;
    setSaving(id);
    setError("");
    try {
      const response = await fetch(isNew ? "/api/staff" : `/api/staff/${id}`, { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Staff account could not be saved."); return; }
      if (isNew) setRows((items) => [{ ...payload, id: data.id, phone: payload.phone || null, role: payload.role as Staff["role"], twoFactorEnabled: false } as Staff, ...items]);
      else setRows((items) => items.map((row) => row.id === id ? { ...row, ...payload, phone: payload.phone || null, role: payload.role as Staff["role"], email: row.email } : row));
      setEditing(null);
    } catch {
      setError("Staff account could not be saved. Check the connection and try again.");
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    if (!current) return;
    setSaving(current.id);
    setError("");
    try {
      const response = await fetch(`/api/staff/${current.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Staff account could not be deleted."); return; }
      setRows((items) => items.filter((row) => row.id !== current.id));
      setEditing(null);
      setConfirmDelete(false);
    } catch {
      setError("Staff account could not be deleted. Check the connection and try again.");
    } finally {
      setSaving(null);
    }
  }

  return <main className="compact-admin-page">
    <header><div><a href="/admin">← Dashboard</a><h1>Staff</h1></div><button onClick={() => openEditor("new")}><Plus /> Add staff</button></header>
    <div className="compact-table-tools"><label><Search /><input placeholder="Search staff name or email" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{shown.length} accounts</span></div>
    <div className="compact-table"><div className="compact-table-head manager-row"><span>Staff member</span><span>Role</span><span>Store</span><span>Phone</span><span>Status</span></div>{shown.map((row) => <div className={`compact-table-row manager-row ${saving === row.id ? "row-saving" : ""}`} key={row.id}>
      <span><UserRound />{row.role === "STAFF" || (canManageAdmins && row.role === "ADMIN") ? <button className="row-link" onClick={() => openEditor(row)}>{row.firstName} {row.lastName}</button> : <b>{row.firstName} {row.lastName}</b>}<small>{row.email}</small></span>
      <b>{row.role.replace("_", " ")}</b><span>{stores.find((store) => store.id === row.homeBranchId)?.name || "Not assigned"}</span><span>{row.phone || "—"}</span>
      <span className={row.isActive ? "status-active" : "status-inactive"}>{saving === row.id ? "Saving…" : row.isActive ? "Active" : "Suspended"}<small className="staff-2fa-state"><ShieldCheck /> {row.twoFactorEnabled ? "Email 2FA active" : "Starts at next login"}</small></span>
    </div>)}</div>
    {editing && <div className="product-modal" onClick={() => setEditing(null)}><form onSubmit={save} onClick={(event) => event.stopPropagation()}>
      <header><h2>{editing === "new" ? "Add staff" : "Edit staff"}</h2><button type="button" onClick={() => setEditing(null)}><X /></button></header>
      <div className="product-form-grid"><label>First name<input name="firstName" defaultValue={current?.firstName || ""} required /></label><label>Last name<input name="lastName" defaultValue={current?.lastName || ""} required /></label><label>Email<input type="email" name="email" defaultValue={current?.email || ""} readOnly={editing !== "new"} required /></label><label>Phone<input name="phone" defaultValue={current?.phone || ""} /></label><label>Role<select name="role" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as "STAFF" | "ADMIN")}><option value="STAFF">Staff</option>{canManageAdmins ? <option value="ADMIN">Administrator</option> : null}</select></label><label>Assigned store<select name="homeBranchId" defaultValue={current?.homeBranchId || ""} required={selectedRole === "STAFF"} disabled={selectedRole === "ADMIN"}><option value="">{selectedRole === "STAFF" ? "Select assigned shop" : "Not assigned"}</option>{stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}</select></label><label className="full">{editing === "new" ? "Temporary password" : "New password (leave blank to keep)"}<input type="password" name="password" minLength={8} required={editing === "new"} /></label><label className="check-label"><input type="checkbox" name="isActive" defaultChecked={current?.isActive ?? true} /> Active account</label></div>
      {current && confirmDelete && <div className="staff-delete-warning"><strong>Delete {current.firstName}’s staff account?</strong><p>Login access will end immediately. Historical order and audit records will remain intact.</p><button type="button" onClick={remove} disabled={saving !== null}><Trash2 /> Permanently disable account</button></div>}
      {error && <div className="auth-error">{error}</div>}
      <footer>{current && (current.role === "STAFF" || (canManageAdmins && current.role === "ADMIN")) ? <button className="staff-delete-trigger" type="button" onClick={() => setConfirmDelete((value) => !value)}><Trash2 /> Delete account</button> : null}<button type="button" onClick={() => setEditing(null)}>Cancel</button><button disabled={saving !== null}>{saving ? "Saving…" : "Save staff"}</button></footer>
    </form></div>}
  </main>;
}
