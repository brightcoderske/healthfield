import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export type IssuedPrescriptionItem = { name: string; quantity: number; directions: string | null };

export type IssuedPrescriptionProps = {
  reference: string;
  issuedAt: Date;
  patientName: string;
  prescriberName: string;
  prescriberRegistration: string;
  notes: string | null;
  items: IssuedPrescriptionItem[];
  business: { pharmacyName: string; phone: string | null; address: string | null; licenceNumber: string | null };
};

const s = StyleSheet.create({
  page: { padding: 40, color: "#111", backgroundColor: "#fff", fontFamily: "Helvetica", fontSize: 10, lineHeight: 1.4 },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 16, letterSpacing: .4 },
  businessLine: { fontSize: 8.5, color: "#444", marginTop: 2 },
  rule: { marginVertical: 14, borderTopWidth: 1, borderTopColor: "#111" },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 12, letterSpacing: 1, textTransform: "uppercase", textAlign: "center" },
  meta: { marginTop: 14, flexDirection: "row", flexWrap: "wrap" },
  metaCell: { width: "50%", marginBottom: 6, paddingRight: 8 },
  label: { fontSize: 7.5, letterSpacing: .6, textTransform: "uppercase", color: "#666" },
  value: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 1 },
  itemsHead: { flexDirection: "row", marginTop: 6, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: "#111", fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: .5, textTransform: "uppercase" },
  itemRow: { flexDirection: "row", paddingVertical: 7, borderBottomWidth: .5, borderBottomColor: "#bbb" },
  colName: { width: "56%", paddingRight: 8 },
  colQty: { width: "14%", textAlign: "right", paddingRight: 8 },
  colDirections: { width: "30%" },
  itemName: { fontFamily: "Helvetica-Bold" },
  directions: { fontSize: 9, color: "#333" },
  notes: { marginTop: 16 },
  notesBody: { marginTop: 4, fontSize: 9.5 },
  signature: { marginTop: 34, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  signatureBlock: { width: "58%" },
  signatureLine: { borderTopWidth: 1, borderTopColor: "#111", paddingTop: 4 },
  footer: { position: "absolute", left: 40, right: 40, bottom: 28, fontSize: 7.5, color: "#666", textAlign: "center" },
});

function formatDate(value: Date) {
  return value.toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function IssuedPrescriptionPdf(props: IssuedPrescriptionProps) {
  const { business } = props;
  return (
    <Document title={`Prescription ${props.reference}`} author={business.pharmacyName}>
      <Page size="A4" style={s.page}>
        <View>
          <Text style={s.brand}>{business.pharmacyName}</Text>
          {business.address ? <Text style={s.businessLine}>{business.address}</Text> : null}
          <Text style={s.businessLine}>
            {[business.phone, business.licenceNumber ? `Licence ${business.licenceNumber}` : null].filter(Boolean).join("  ·  ")}
          </Text>
        </View>
        <View style={s.rule} />
        <Text style={s.heading}>Prescription</Text>

        <View style={s.meta}>
          <View style={s.metaCell}><Text style={s.label}>Patient</Text><Text style={s.value}>{props.patientName}</Text></View>
          <View style={s.metaCell}><Text style={s.label}>Reference</Text><Text style={s.value}>{props.reference}</Text></View>
          <View style={s.metaCell}><Text style={s.label}>Issued</Text><Text style={s.value}>{formatDate(props.issuedAt)}</Text></View>
          <View style={s.metaCell}><Text style={s.label}>Prescriber</Text><Text style={s.value}>{props.prescriberName}</Text></View>
          <View style={s.metaCell}><Text style={s.label}>Registration number</Text><Text style={s.value}>{props.prescriberRegistration}</Text></View>
        </View>

        <View style={s.itemsHead}>
          <Text style={s.colName}>Medicine</Text>
          <Text style={s.colQty}>Quantity</Text>
          <Text style={s.colDirections}>Directions</Text>
        </View>
        {props.items.map((item, index) => (
          <View key={`${item.name}-${index}`} style={s.itemRow} wrap={false}>
            <View style={s.colName}><Text style={s.itemName}>{item.name}</Text></View>
            <Text style={s.colQty}>{item.quantity}</Text>
            <Text style={[s.colDirections, s.directions]}>{item.directions || "As directed"}</Text>
          </View>
        ))}

        {props.notes ? (
          <View style={s.notes}>
            <Text style={s.label}>Notes for the dispensing pharmacist</Text>
            <Text style={s.notesBody}>{props.notes}</Text>
          </View>
        ) : null}

        <View style={s.signature}>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine}>
              <Text style={s.value}>{props.prescriberName}</Text>
              <Text style={s.businessLine}>Registration {props.prescriberRegistration}</Text>
            </View>
          </View>
        </View>

        <Text style={s.footer} fixed>
          Issued electronically following an online consultation on {formatDate(props.issuedAt)}. Valid only for the named patient.
        </Text>
      </Page>
    </Document>
  );
}
