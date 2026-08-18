import { notFound } from "next/navigation";
import { OrderReceiptActions } from "@/app/admin/orders/[id]/order-receipt-actions";
import { OrderStatusManager } from "@/app/admin/orders/[id]/order-status-manager";
import { BackendError, backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";
import { hasStaffPermission } from "@/lib/staff-permissions";
import type { OrderFulfilmentMethod, OrderStatus } from "@/lib/order-status-transitions";

export const dynamic="force-dynamic";
type Data={order:{id:number;orderNumber:string;status:OrderStatus;customerName:string;phone:string;email:string|null;fulfilmentMethod:OrderFulfilmentMethod;paymentStatus:string;paymentMethod:string;paymentReference:string|null;amountPaid:string;deliveryAddress:string|null;deliveryArea:string|null;deliveryLatitude:string|null;deliveryLongitude:string|null;deliveryFee:string;deliveryDistanceKm:string|null;deliveryCourier:string|null;total:string};items:Array<{id:number;productId:number|null;productName:string;quantity:number;unitPrice:string;lineTotal:string}>;stores?:Array<{id:number;name:string}>;fulfilments?:Array<{orderItemId:number;branchId:number;quantityReserved:number;quantityPacked:number;status:"UNASSIGNED"|"RESERVED"|"PARTIALLY_RESERVED"|"PACKED"|"READY"|"UNAVAILABLE"|"REPLACED"}>;stock?:Array<{productId:number;branchId:number;available:number}>;payments?:Array<{id:number;method:"MPESA_EXPRESS"|"MANUAL_MPESA"|"CASH";channel:"ONLINE"|"POS";status:string;amount:string;phone:string|null;receiptNumber:string|null;manualMessage:string|null;resultDescription:string|null;createdAt:string}>};

export default async function StaffOrderPage({params}:{params:Promise<{id:string}>}){
  const session=await requireStaffPermission("ORDERS_VIEW");
  const id=Number((await params).id);let data:Data;
  try{data=await backendJson<Data>(`/v1/views/staff/orders/${id}`)}catch(error){if(error instanceof BackendError&&error.status===404)notFound();throw error}
  const canProcess=hasStaffPermission(session.role,session.permissions,"ORDERS_PROCESS"),canReviewPayments=hasStaffPermission(session.role,session.permissions,"PAYMENTS_REVIEW"),canViewReceipts=hasStaffPermission(session.role,session.permissions,"RECEIPTS_VIEW");
  return <>{canViewReceipts?<OrderReceiptActions orderId={id} basePath="/staff/receipts/orders"/>:null}<OrderStatusManager order={{...data.order,id}} items={data.items??[]} stores={data.stores??[]} fulfilments={data.fulfilments??[]} stock={data.stock??[]} payments={data.payments??[]} ordersBasePath="/staff/orders" canProcess={canProcess} canReviewPayments={canReviewPayments}/></>;
}
