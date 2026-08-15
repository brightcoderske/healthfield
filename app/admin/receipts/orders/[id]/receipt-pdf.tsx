/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop. */
import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { paymentMethodLabel, type ThermalReceiptProps } from "./thermal-receipt-data";

export type ReceiptPdfProps = ThermalReceiptProps;

const WIDTH = 226.77;
const WEBSITE = "healthfieldpharmacy.co.ke";
const dash = "----------------------------------------";

Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: { padding: "18 14 20", color: "#111", backgroundColor: "#fff", fontFamily: "Courier", fontSize: 7.3, lineHeight: 1.25 },
  center: { textAlign: "center", alignItems: "center" },
  logo: { width: 66, height: 24, objectFit: "contain", marginBottom: 2 },
  brand: { fontFamily: "Courier-Bold", fontSize: 11, letterSpacing: .4, textTransform: "uppercase" },
  tagline: { marginTop: 1, fontSize: 7, fontFamily: "Courier-Oblique" },
  businessGrid: { marginTop: 5, flexDirection: "row", flexWrap: "wrap" },
  businessWide: { width: "100%", paddingRight: 4, marginBottom: 2, flexDirection: "row" },
  label: { fontFamily: "Courier-Bold", marginRight: 3 },
  separator: { marginVertical: 5, fontSize: 7, letterSpacing: -.25 },
  separatorStrong: { height: 4, marginVertical: 5, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#111" },
  heading: { textAlign: "center", fontFamily: "Courier-Bold", fontSize: 9, letterSpacing: .8 },
  info: { marginTop: 5 },
  infoRow: { flexDirection: "row", marginBottom: 2 },
  infoCell: { width: "50%", paddingRight: 4, flexDirection: "row", justifyContent: "space-between" },
  infoWide: { width: "100%", flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  value: { maxWidth: "58%", textAlign: "right" },
  itemHead: { flexDirection: "row", paddingBottom: 2, fontFamily: "Courier-Bold", fontSize: 6.7 },
  itemRow: { flexDirection: "row", paddingVertical: 4, borderTopWidth: .5, borderTopStyle: "dotted", borderTopColor: "#777" },
  item: { width: "45%", paddingRight: 3 },
  itemName: { fontFamily: "Courier-Bold", fontSize: 7.3 },
  pack: { marginTop: 1, fontSize: 6.4 },
  qty: { width: "10%", textAlign: "right" },
  price: { width: "21%", textAlign: "right" },
  amount: { width: "24%", textAlign: "right" },
  totalLine: { flexDirection: "row", justifyContent: "space-between", minHeight: 13 },
  grandTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", fontFamily: "Courier-Bold", fontSize: 10.5 },
  currency: { fontSize: 7, marginRight: 4 },
  status: { textAlign: "center", fontSize: 6.7, textTransform: "uppercase" },
  footer: { marginTop: 9, textAlign: "center", alignItems: "center" },
  thanks: { fontFamily: "Courier-Bold", fontSize: 10, letterSpacing: .6, marginBottom: 5 },
  footerText: { marginBottom: 5 },
  footerBrand: { marginBottom: 5, fontSize: 6.2 },
  barcode: { width: 150, height: 30, marginTop: 3, objectFit: "fill" },
  receiptNumber: { marginTop: 4, fontFamily: "Courier-Bold", fontSize: 7, letterSpacing: .4 },
});

function money(value: string | number) {
  return Number(value).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeZone: "Africa/Nairobi" }).format(new Date(value));
}

function time(value: string) {
  return new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date(value));
}

export function ReceiptPdf({ order, items, payment, branch, business, servedBy, receiptNumber, barcodeDataUrl, logoDataUrl }: ReceiptPdfProps) {
  const paymentMethod = paymentMethodLabel(payment?.method || order.paymentMethod);
  const mpesaCode = paymentMethod.includes("M-Pesa") ? payment?.receiptNumber || order.paymentReference : null;
  const transactionAt = payment?.verifiedAt || payment?.createdAt || order.createdAt;
  const contactPhone = branch?.phone || business.phone;
  const location = branch?.address || business.address;
  const detailLines = 15 + (mpesaCode ? 1 : 0) + (business.licenceNumber ? 1 : 0) + (business.taxNumber ? 1 : 0);
  const itemLines = items.reduce((sum, item) => sum + Math.max(1, Math.ceil(item.productName.length / 25)) + (item.packSize ? 1 : 0), 0);
  const pageHeight = 285 + detailLines * 6 + itemLines * 12 + items.length * 10 + (barcodeDataUrl ? 38 : 0);
  const paid = order.paymentStatus === "PAID";

  return <Document title={`Receipt ${receiptNumber}`} author="Healthfield Pharmacy">
    <Page size={[WIDTH, pageHeight]} style={s.page} wrap={false}>
      <View style={s.center}>
        {logoDataUrl ? <Image src={logoDataUrl} style={s.logo}/> : null}
        <Text style={s.brand}>{business.pharmacyName || "Healthfield Pharmacy"}</Text>
        <Text style={s.tagline}>Your Health. Our Priority.</Text>
      </View>
      <View style={s.businessGrid}>
        {branch ? <View style={s.businessWide}><Text style={s.label}>BRANCH:</Text><Text>{branch.name}</Text></View> : null}
        {location ? <View style={s.businessWide}><Text style={s.label}>LOCATION:</Text><Text>{location}</Text></View> : null}
        {contactPhone ? <View style={s.businessWide}><Text style={s.label}>PHONE:</Text><Text>{contactPhone}</Text></View> : null}
        <View style={s.businessWide}><Text style={s.label}>WEB:</Text><Text>{WEBSITE}</Text></View>
        {business.taxNumber ? <View style={s.businessWide}><Text style={s.label}>PIN/VAT:</Text><Text>{business.taxNumber}</Text></View> : null}
        {business.licenceNumber ? <View style={s.businessWide}><Text style={s.label}>LICENCE:</Text><Text>{business.licenceNumber}</Text></View> : null}
      </View>
      <Text style={s.separator}>{dash}</Text>
      <Text style={s.heading}>SALES RECEIPT</Text>
      <View style={s.info}>
        <View style={s.infoRow}>
          <View style={s.infoCell}><Text style={s.label}>Receipt:</Text><Text style={s.value}>{receiptNumber}</Text></View>
          <View style={s.infoCell}><Text style={s.label}>Order:</Text><Text style={s.value}>{order.orderNumber}</Text></View>
        </View>
        <View style={s.infoRow}>
          <View style={s.infoCell}><Text style={s.label}>Date:</Text><Text style={s.value}>{date(transactionAt)}</Text></View>
          <View style={s.infoCell}><Text style={s.label}>Time:</Text><Text style={s.value}>{time(transactionAt)}</Text></View>
        </View>
        {servedBy ? <View style={s.infoWide}><Text style={s.label}>Served By:</Text><Text>{servedBy}</Text></View> : null}
        <View style={s.infoWide}><Text style={s.label}>Payment:</Text><Text>{paymentMethod}</Text></View>
        {mpesaCode ? <View style={s.infoWide}><Text style={s.label}>M-Pesa Code:</Text><Text>{mpesaCode}</Text></View> : null}
        <View style={s.infoWide}><Text style={s.label}>Customer:</Text><Text>{order.customerName}</Text></View>
      </View>
      <Text style={s.separator}>{dash}</Text>
      <View style={s.itemHead}><Text style={s.item}>ITEM</Text><Text style={s.qty}>QTY</Text><Text style={s.price}>PRICE</Text><Text style={s.amount}>TOTAL</Text></View>
      {items.map((item, index) => <View style={s.itemRow} wrap={false} key={`${item.productName}-${index}`}>
        <View style={s.item}><Text style={s.itemName}>{item.productName}</Text>{item.packSize ? <Text style={s.pack}>{item.packSize}</Text> : null}</View>
        <Text style={s.qty}>{item.quantity}</Text><Text style={s.price}>{money(item.unitPrice)}</Text><Text style={s.amount}>{money(item.lineTotal)}</Text>
      </View>)}
      <Text style={s.separator}>{dash}</Text>
      <View style={s.totalLine}><Text>Subtotal</Text><Text>{money(order.subtotal)}</Text></View>
      <View style={s.totalLine}><Text>Delivery Fee</Text><Text>{money(order.deliveryFee)}</Text></View>
      {Number(order.discount) !== 0 ? <View style={s.totalLine}><Text>Discount</Text><Text>-{money(order.discount)}</Text></View> : null}
      {order.vat !== null && order.vat !== undefined ? <View style={s.totalLine}><Text>VAT</Text><Text>{money(order.vat)}</Text></View> : null}
      {order.amountTendered !== null && order.amountTendered !== undefined ? <View style={s.totalLine}><Text>Amount Tendered</Text><Text>{money(order.amountTendered)}</Text></View> : null}
      {order.change !== null && order.change !== undefined ? <View style={s.totalLine}><Text>Change</Text><Text>{money(order.change)}</Text></View> : null}
      <Text style={s.separator}>{dash}</Text>
      <View style={s.grandTotal}><Text>{paid ? "TOTAL PAID" : "ORDER TOTAL"}</Text><View style={{ flexDirection: "row", alignItems: "baseline" }}><Text style={s.currency}>KSh</Text><Text>{money(paid ? order.amountPaid : order.total)}</Text></View></View>
      <View style={s.separatorStrong}/>
      <Text style={s.status}>Payment status: {order.paymentStatus.replaceAll("_", " ")}</Text>
      <View style={s.footer}>
        <Text style={s.thanks}>THANK YOU!</Text>
        <Text style={s.footerBrand}>Healthfield Pharmacy - Your Health. Our Priority.</Text>
        <Text style={s.footerText}>Help: {contactPhone || "Contact your branch"}{"\n"}{WEBSITE}</Text>
        {barcodeDataUrl ? <Image src={barcodeDataUrl} style={s.barcode}/> : null}
        <Text style={s.receiptNumber}>{receiptNumber}</Text>
      </View>
    </Page>
  </Document>;
}
