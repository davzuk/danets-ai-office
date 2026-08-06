import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export interface InvoicePdfItem {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
}

export interface InvoicePdfProps {
  invoice: {
    invoiceNumber: string;
    amount: number;
    currency: string;
    status: string;
    dueDate?: string | null;
    paidAt?: string | null;
    notes?: string | null;
    createdAt: string;
  };
  business: {
    name: string;
    email?: string | null;
    phone?: string | null;
  };
  items: InvoicePdfItem[];
  customerName?: string | null;
  customerEmail?: string | null;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 60,
    paddingHorizontal: 50,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: "#1a1a2e",
    lineHeight: 1.5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: "#1d4ed8",
  },
  brand: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1d4ed8",
  },
  brandSub: {
    fontSize: 9,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginTop: 2,
  },
  invoiceMeta: {
    alignItems: "flex-end",
  },
  invoiceLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#1a1a2e",
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  invoiceNumber: {
    fontSize: 10,
    color: "#374151",
    marginTop: 2,
  },
  statusBadge: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 8,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 1,
    borderRadius: 3,
  },
  billToRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  partyBlock: {
    flex: 1,
    paddingRight: 12,
  },
  partyLabel: {
    fontSize: 8,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  partyName: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#1a1a2e",
    marginBottom: 2,
  },
  partyLine: {
    fontSize: 9.5,
    color: "#4b5563",
    marginBottom: 1,
  },
  table: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  tableHead: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
  },
  tableHeadCell: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  cellDescription: { flex: 5, paddingHorizontal: 6 },
  cellQty: { flex: 1, paddingHorizontal: 6, textAlign: "right" },
  cellPrice: { flex: 2, paddingHorizontal: 6, textAlign: "right" },
  cellTotal: { flex: 2, paddingHorizontal: 6, textAlign: "right" },
  totalsBlock: {
    marginTop: 18,
    alignItems: "flex-end",
  },
  totalsRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  totalsLabel: {
    width: 120,
    fontSize: 10,
    color: "#4b5563",
    textAlign: "right",
    paddingRight: 12,
  },
  totalsValue: {
    width: 110,
    fontSize: 10,
    color: "#1a1a2e",
    textAlign: "right",
  },
  grandTotal: {
    fontWeight: "bold",
    fontSize: 12,
    color: "#1d4ed8",
  },
  notes: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  notesLabel: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 9.5,
    color: "#4b5563",
    lineHeight: 1.4,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 50,
    right: 50,
    textAlign: "center",
    fontSize: 8,
    color: "#9ca3af",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
  },
});

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  paid: { bg: "#dcfce7", fg: "#166534" },
  sent: { bg: "#dbeafe", fg: "#1e40af" },
  draft: { bg: "#f3f4f6", fg: "#374151" },
  overdue: { bg: "#fee2e2", fg: "#991b1b" },
  void: { bg: "#f3f4f6", fg: "#6b7280" },
};

function formatMoney(amount: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "";
  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function InvoicePDF({
  invoice,
  business,
  items,
  customerName,
  customerEmail,
}: InvoicePdfProps) {
  const statusKey = (invoice.status || "draft").toLowerCase();
  const statusColor = STATUS_COLORS[statusKey] || STATUS_COLORS.draft;

  // Items may already sum to invoice.amount; we re-sum defensively.
  const computedSubtotal = items.reduce(
    (sum, it) => sum + (typeof it.total === "number" ? it.total : 0),
    0
  );

  return (
    <Document
      title={`Invoice ${invoice.invoiceNumber}`}
      author={business.name}
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{business.name}</Text>
            <Text style={styles.brandSub}>Danets AI Automation · Invoice</Text>
            {business.email ? (
              <Text style={{ fontSize: 9, color: "#4b5563", marginTop: 4 }}>
                {business.email}
              </Text>
            ) : null}
            {business.phone ? (
              <Text style={{ fontSize: 9, color: "#4b5563" }}>
                {business.phone}
              </Text>
            ) : null}
          </View>
          <View style={styles.invoiceMeta}>
            <Text style={styles.invoiceLabel}>Invoice</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: statusColor.bg, color: statusColor.fg },
              ]}
            >
              <Text style={{ color: statusColor.fg }}>{invoice.status}</Text>
            </View>
          </View>
        </View>

        {/* Bill-to and dates */}
        <View style={styles.billToRow}>
          <View style={styles.partyBlock}>
            <Text style={styles.partyLabel}>Bill to</Text>
            <Text style={styles.partyName}>
              {customerName || business.name}
            </Text>
            {customerEmail ? (
              <Text style={styles.partyLine}>{customerEmail}</Text>
            ) : null}
          </View>
          <View style={styles.partyBlock}>
            <Text style={styles.partyLabel}>Issued</Text>
            <Text style={styles.partyLine}>{formatDate(invoice.createdAt)}</Text>
            <Text style={[styles.partyLabel, { marginTop: 8 }]}>Due</Text>
            <Text style={styles.partyLine}>{formatDate(invoice.dueDate)}</Text>
            {invoice.paidAt ? (
              <>
                <Text style={[styles.partyLabel, { marginTop: 8 }]}>Paid</Text>
                <Text style={styles.partyLine}>{formatDate(invoice.paidAt)}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* Items table */}
        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={[styles.tableHeadCell, styles.cellDescription]}>
              Description
            </Text>
            <Text style={[styles.tableHeadCell, styles.cellQty]}>Qty</Text>
            <Text style={[styles.tableHeadCell, styles.cellPrice]}>
              Unit price
            </Text>
            <Text style={[styles.tableHeadCell, styles.cellTotal]}>Total</Text>
          </View>
          {items.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[styles.cellDescription, { color: "#9ca3af" }]}>
                No line items
              </Text>
            </View>
          ) : (
            items.map((it, idx) => (
              <View key={idx} style={styles.tableRow}>
                <Text style={styles.cellDescription}>
                  {it.description || "—"}
                </Text>
                <Text style={styles.cellQty}>{it.quantity ?? 1}</Text>
                <Text style={styles.cellPrice}>
                  {formatMoney(it.unitPrice ?? 0, invoice.currency)}
                </Text>
                <Text style={styles.cellTotal}>
                  {formatMoney(it.total ?? 0, invoice.currency)}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Totals */}
        <View style={styles.totalsBlock}>
          {computedSubtotal > 0 &&
          Math.abs(computedSubtotal - invoice.amount) > 0.005 ? (
            <>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Subtotal</Text>
                <Text style={styles.totalsValue}>
                  {formatMoney(computedSubtotal, invoice.currency)}
                </Text>
              </View>
            </>
          ) : null}
          <View style={styles.totalsRow}>
            <Text style={[styles.totalsLabel, styles.grandTotal]}>
              Total due
            </Text>
            <Text style={[styles.totalsValue, styles.grandTotal]}>
              {formatMoney(invoice.amount, invoice.currency)}
            </Text>
          </View>
        </View>

        {/* Notes */}
        {invoice.notes ? (
          <View style={styles.notes}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        ) : null}

        {/* Footer */}
        <Text style={styles.footer} fixed>
          Generated by Danets AI Automation · {business.name} · Confidential
        </Text>
      </Page>
    </Document>
  );
}
