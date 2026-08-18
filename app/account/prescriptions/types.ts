export type CustomerPrescriptionItem = {
  id: number;
  productId: number | null;
  productName: string;
  requestedQuantity: number;
  approvedQuantity: number | null;
  unitPrice: string | null;
  availability: "PENDING" | "AVAILABLE" | "PARTIALLY_AVAILABLE" | "UNAVAILABLE";
  source: "CUSTOMER_CART" | "PHARMACIST";
  dispenseRule: "COURSE_BOUND" | "DIVISIBLE";
  minimumQuantity: number | null;
  selectedQuantity: number | null;
  deferred: boolean;
  pharmacistNote: string | null;
};

export type CustomerPrescriptionOrder = {
  id: number;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  fulfilmentMethod: "DELIVERY" | "PICKUP";
  subtotal: string;
  deliveryFee: string;
  total: string;
};

export type CustomerPrescriptionData = {
  request: {
    id: number;
    originalFilename: string;
    mimeType: string;
    status: string;
    pharmacistNotes: string | null;
    createdAt: string;
    reviewedAt: string | null;
  };
  items: CustomerPrescriptionItem[];
  order: CustomerPrescriptionOrder | null;
  customer: { firstName: string; lastName: string; email: string; phone: string | null };
  payment: { onlineMpesaEnabled: boolean; onlineManualEnabled: boolean; tillNumber: string | null; accountName: string | null };
};
