import Image from "next/image";
import { paymentMethodLabel, type ThermalReceiptProps } from "./thermal-receipt-data";

const WEBSITE = "healthfieldpharmacy.co.ke";

function money(value: string | number) {
  return Number(value).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function transactionDate(value: string) {
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeZone: "Africa/Nairobi" }).format(new Date(value));
}

function transactionTime(value: string) {
  return new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date(value));
}

function ReceiptSeparator({ strong = false }: { strong?: boolean }) {
  return <div className={strong ? "thermal-separator thermal-separator-strong" : "thermal-separator"} aria-hidden="true"/>;
}

export function ThermalReceipt({ order, items, payment, branch, business, servedBy, receiptNumber, barcodeDataUrl }: ThermalReceiptProps) {
  const paymentMethod = paymentMethodLabel(payment?.method || order.paymentMethod);
  const mpesaCode = paymentMethod.includes("M-Pesa") ? payment?.receiptNumber || order.paymentReference : null;
  const paid = order.paymentStatus === "PAID";
  const transactionAt = payment?.verifiedAt || payment?.createdAt || order.createdAt;
  const contactPhone = branch?.phone || business.phone;
  const location = branch?.address || business.address;

  return <article className="thermal-receipt thermal-receipt-print-area" aria-label={`Sales receipt ${receiptNumber}`}>
    <header className="thermal-receipt-header">
      <Image className="thermal-receipt-logo" src="/healthfield-logo-clean.png" width={92} height={33} sizes="92px" alt="Healthfield Pharmacy" priority/>
      <h1>{business.pharmacyName || "Healthfield Pharmacy"}</h1>
      <p>Your Health. Our Priority.</p>
      <div className="thermal-business-details">
        {branch ? <span><b>Branch</b>{branch.name}</span> : null}
        {location ? <span><b>Location</b>{location}</span> : null}
        {contactPhone ? <span><b>Phone</b>{contactPhone}</span> : null}
        <span className="thermal-business-wide"><b>Web</b>{WEBSITE}</span>
        {business.taxNumber ? <span><b>PIN / VAT</b>{business.taxNumber}</span> : null}
        {business.licenceNumber ? <span><b>Licence</b>{business.licenceNumber}</span> : null}
      </div>
    </header>

    <ReceiptSeparator/>
    <h2>SALES RECEIPT</h2>
    <dl className="thermal-transaction-grid">
      <div><dt>Receipt No.</dt><dd>{receiptNumber}</dd></div>
      <div><dt>Order No.</dt><dd>{order.orderNumber}</dd></div>
      <div><dt>Date</dt><dd>{transactionDate(transactionAt)}</dd></div>
      <div><dt>Time</dt><dd>{transactionTime(transactionAt)}</dd></div>
      {servedBy ? <div><dt>Served By</dt><dd>{servedBy}</dd></div> : null}
      <div><dt>Payment</dt><dd>{paymentMethod}</dd></div>
      {mpesaCode ? <div className="thermal-wide"><dt>M-Pesa Code</dt><dd>{mpesaCode}</dd></div> : null}
      <div className="thermal-wide"><dt>Customer</dt><dd>{order.customerName}</dd></div>
    </dl>

    <ReceiptSeparator/>
    <table className="thermal-items">
      <thead><tr><th>ITEM</th><th>QTY</th><th>PRICE</th><th>TOTAL</th></tr></thead>
      <tbody>{items.map((item, index) => <tr key={`${item.productName}-${index}`}>
        <td><strong>{item.productName}</strong>{item.packSize ? <small>{item.packSize}</small> : null}</td>
        <td>{item.quantity}</td>
        <td>{money(item.unitPrice)}</td>
        <td>{money(item.lineTotal)}</td>
      </tr>)}</tbody>
    </table>

    <ReceiptSeparator/>
    <dl className="thermal-totals">
      <div><dt>Subtotal</dt><dd>{money(order.subtotal)}</dd></div>
      <div><dt>Delivery Fee</dt><dd>{money(order.deliveryFee)}</dd></div>
      {Number(order.discount) !== 0 ? <div><dt>Discount</dt><dd>-{money(order.discount)}</dd></div> : null}
      {order.vat !== null && order.vat !== undefined ? <div><dt>VAT</dt><dd>{money(order.vat)}</dd></div> : null}
      {order.amountTendered !== null && order.amountTendered !== undefined ? <div><dt>Amount Tendered</dt><dd>{money(order.amountTendered)}</dd></div> : null}
      {order.change !== null && order.change !== undefined ? <div><dt>Change</dt><dd>{money(order.change)}</dd></div> : null}
    </dl>
    <ReceiptSeparator/>
    <div className="thermal-grand-total"><span>{paid ? "TOTAL PAID" : "ORDER TOTAL"}</span><b><small>KSh</small>{money(paid ? order.amountPaid : order.total)}</b></div>
    <ReceiptSeparator strong/>
    <p className="thermal-payment-status">Payment status: <b>{order.paymentStatus.replaceAll("_", " ")}</b></p>

    <footer className="thermal-receipt-footer">
      <h3>THANK YOU!</h3>
      <p className="thermal-footer-brand"><b>Healthfield Pharmacy</b> - Your Health. Our Priority.</p>
      <p>Help: {contactPhone || "Contact your branch"}<br/>{WEBSITE}</p>
      {barcodeDataUrl ? <div className="thermal-barcode"><Image src={barcodeDataUrl} width={210} height={42} sizes="210px" unoptimized alt={`Barcode ${receiptNumber}`}/></div> : null}
      <strong className="thermal-receipt-number">{receiptNumber}</strong>
    </footer>
  </article>;
}
