export type PosBranch = { id: number; name: string; code: string };
export type PosTill = { id: number; branchId: number; name: string; code: string; mpesaTillNumber: string | null };
export type PosProduct = { id: number; name: string; sku: string; barcode: string | null; brand: string | null; packSize: string | null; imageUrl: string | null; price: number; discountPrice: number | null };
export type PosStock = { branchId: number; productId: number; available: number; reorderLevel: number };
export type PosSession = { id: number; sessionNumber: string; branchId: number; tillId: number; branchName: string; tillName: string; openingFloat: number; openingCash: number; openedAt: string };
export type HeldSale = { id: number; label: string; customerName: string | null; phone: string | null; email: string | null; cart: Array<{ productId: number; quantity: number }>; discountAmount: number; heldAt: string };
export type PosExpense = { id: number; category: string; description: string; amount: number; paymentMethod: "CASH" | "MPESA" | "OTHER"; reference: string | null; incurredAt: string };
export type PosTotals = { sales: number; profit: number; cashSales: number; mpesaSales: number; manualSales: number; discounts: number; expenses: number; cashExpenses: number; expectedCash: number; transactionCount: number; stockReceivedUnits: number } | null;
export type PosCashier = { id: number; name: string; role: string; branchId?: number | null };
export type PosSupplier = { id: number; name: string; phone: string | null; lastReceivedAt: string | null };
export type PosWorkspaceData = {
  cashier: PosCashier;
  cashiers?: PosCashier[];
  branches: PosBranch[];
  tills: PosTill[];
  products: PosProduct[];
  suppliers: PosSupplier[];
  stock: PosStock[];
  activeSession: PosSession | null;
  heldSales: HeldSale[];
  expenses: PosExpense[];
  totals: PosTotals;
  payment: { cashEnabled: boolean; mpesaEnabled: boolean; manualEnabled: boolean; tillNumber: string | null; accountName: string | null };
  /** Optional: the API service deploys separately, so an older build omits it. */
  vat?: { enabled: boolean; rate: number };
};

export type PosReport = {
  summary: { sales: number; orders: number; discounts: number; refunds: number; profit: number | null; unpricedSales: number | null };
  dailySales: Array<{ date: string; sales: number; orders: number }>;
  paymentMethods: Array<{ method: string; amount: number }>;
  cashierPerformance: Array<{ cashier: string; cashierId: number | null; sales: number; orders: number }>;
  bestProducts: Array<{ product: string; units: number; sales: number }>;
  sessions: Array<{ sessionNumber: string; branchName: string; cashierFirst: string; cashierLast: string; sales: number; expectedCash: number | null; actualCash: number | null; cashDifference: number | null; openedAt: string; closedAt: string | null }>;
  lowStock: Array<{ product: string; branch: string; available: number; reorderLevel: number }>;
  expiringProducts: Array<{ product: string; branch: string; batchNumber: string | null; expiryDate: string; quantityRemaining: number }>;
  stockReceived: Array<{ receiptNumber: string; supplier: string; branch: string; product: string; quantity: number; buyingPrice: string; batchNumber: string | null; expiryDate: string | null; receivedAt: string }>;
};
