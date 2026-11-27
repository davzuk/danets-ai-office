import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { MagnetContent } from "./content";

// The PDF for an AI-written lead magnet. Plain, readable and branded with
// the tenant's name and accent colour.

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 52, fontSize: 11, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.5 },
  brand: { fontSize: 10, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 24, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 10 },
  rule: { height: 3, width: 56, marginBottom: 18 },
  intro: { fontSize: 12, color: "#374151", marginBottom: 18 },
  section: { marginBottom: 16 },
  heading: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 6 },
  paragraph: { marginBottom: 6 },
  item: { flexDirection: "row", marginBottom: 4 },
  box: { width: 9, height: 9, borderWidth: 1, borderColor: "#6b7280", marginTop: 3, marginRight: 8 },
  bullet: { width: 12, fontFamily: "Helvetica-Bold" },
  itemText: { flex: 1 },
  closing: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#e5e7eb", color: "#374151" },
  footer: { position: "absolute", bottom: 28, left: 52, right: 52, fontSize: 9, color: "#9ca3af", flexDirection: "row", justifyContent: "space-between" },
});

export interface MagnetPdfProps {
  title: string;
  businessName: string;
  accent: string;
  style: "checklist" | "guide";
  content: MagnetContent;
}

export function MagnetPDF({ title, businessName, accent, style, content }: MagnetPdfProps) {
  return (
    <Document title={title} author={businessName} creator={businessName} producer={businessName}>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>{businessName}</Text>
        <Text style={s.title}>{title}</Text>
        <View style={[s.rule, { backgroundColor: accent }]} />
        {content.intro ? <Text style={s.intro}>{content.intro}</Text> : null}
        {content.sections.map((sec, i) => (
          <View key={i} style={s.section} wrap={sec.items.length > 8}>
            <Text style={s.heading}>{style === "guide" ? `${i + 1}. ${sec.heading}` : sec.heading}</Text>
            {sec.paragraph ? <Text style={s.paragraph}>{sec.paragraph}</Text> : null}
            {sec.items.map((it, j) => (
              <View key={j} style={s.item}>
                {style === "checklist" ? <View style={s.box} /> : <Text style={[s.bullet, { color: accent }]}>•</Text>}
                <Text style={s.itemText}>{it}</Text>
              </View>
            ))}
          </View>
        ))}
        {content.closing ? <Text style={s.closing}>{content.closing}</Text> : null}
        <View style={s.footer} fixed>
          <Text>{businessName}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Render to a PDF buffer (react-pdf v4 returns a stream from toBuffer). */
export async function renderMagnetPdf(props: MagnetPdfProps): Promise<Buffer> {
  const stream = await pdf(MagnetPDF(props)).toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
