export type PrescriptionSelection = {
  id: number;
  name?: string;
  quantity?: number;
};

export function safeLocalPath(
  value: string | null | undefined,
  fallback = "/",
) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export function normalizePrescriptionSelections(
  items: PrescriptionSelection[],
) {
  const quantities = new Map<number, number>();
  for (const item of items.slice(0, 50)) {
    const id = Number(item.id);
    const quantity = Math.min(99, Math.max(1, Number(item.quantity) || 1));
    if (Number.isInteger(id) && id > 0)
      quantities.set(id, Math.min(99, (quantities.get(id) || 0) + quantity));
  }
  return [...quantities].map(([id, quantity]) => ({ id, quantity }));
}

export function parsePrescriptionSelections(
  value: string | string[] | undefined,
) {
  const raw = Array.isArray(value) ? value.join(",") : value || "";
  return normalizePrescriptionSelections(
    raw.split(",").map((entry) => {
      const [id, quantity] = entry.split(":");
      return { id: Number(id), quantity: Number(quantity || 1) };
    }),
  );
}

export function prescriptionUploadHref(items: PrescriptionSelection[]) {
  const normalized = normalizePrescriptionSelections(items);
  if (!normalized.length) return "/prescriptions/upload";
  const encoded = normalized
    .map((item) => `${item.id}:${item.quantity}`)
    .join(",");
  return `/prescriptions/upload?items=${encodeURIComponent(encoded)}`;
}
