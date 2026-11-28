import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { BriefData } from "./briefs";

// A content brief as a PDF to hand to a writer. Plain and readable, with
// the "[Add …]" gaps highlighted so they aren't missed.

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 52, paddingHorizontal: 50, fontSize: 10.5, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.45 },
  brand: { fontSize: 9, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 4 },
  note: { fontSize: 9.5, color: "#6b7280", marginBottom: 16 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#111827", marginTop: 12, marginBottom: 5 },
  h3: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#111827", marginTop: 6, marginBottom: 3 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 96, color: "#6b7280" },
  value: { flex: 1 },
  bullet: { width: 10 },
  item: { flex: 1 },
  gap: { backgroundColor: "#fef3c7", color: "#92400e" },
  q: { fontFamily: "Helvetica-Bold", marginTop: 4 },
  source: { color: "#6b7280" },
  // A fixed absolute Text repeats on every page (a fixed View, or a render prop, didn't draw).
  footer: { position: "absolute", bottom: 26, left: 50, right: 50, fontSize: 8.5, color: "#9ca3af" },
});

/** Text with "[Add …]" placeholders highlighted. */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\[Add[^\]]*\])/g);
  return (
    <Text>
      {parts.map((p, i) => (p.startsWith("[Add") ? <Text key={i} style={s.gap}>{p}</Text> : p))}
    </Text>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={s.row}>
      <Text style={s.bullet}>•</Text>
      <View style={s.item}>
        <Marked text={text} />
      </View>
    </View>
  );
}

export interface BriefPdfProps {
  query: string;
  businessName: string;
  brief: BriefData & { cluster?: string[] };
}

export function BriefPDF({ query, businessName, brief: b }: BriefPdfProps) {
  return (
    <Document title={`Content brief: ${query}`} author={businessName} creator={businessName} producer={businessName}>
      <Page size="A4" style={s.page}>
        <Text style={s.footer} fixed>
          {`Content brief: ${query} · ${businessName}`}
        </Text>
        <Text style={s.brand}>{businessName}</Text>
        <Text style={s.title}>Content brief: {query}</Text>
        <Text style={s.note}>Highlighted [Add …] items need real details before the page is published.</Text>

        <Text style={s.h2}>Search intent</Text>
        <Text>
          {b.intent} ({b.intentType})
        </Text>

        <Text style={s.h2}>Page basics</Text>
        {(
          [
            ["Title", b.title],
            ["Meta description", b.metaDescription],
            ["H1", b.h1],
            ["Length", `about ${b.wordCount} words`],
          ] as const
        ).map(([k, v]) => (
          <View key={k} style={s.row}>
            <Text style={s.label}>{k}</Text>
            <View style={s.value}>
              <Marked text={v} />
            </View>
          </View>
        ))}

        <Text style={s.h2}>Outline</Text>
        {b.outline.map((sec, i) => (
          <View key={i} wrap={false}>
            <Text style={s.h3}>{sec.heading}</Text>
            {sec.points.map((p, j) => (
              <Bullet key={j} text={p} />
            ))}
          </View>
        ))}

        {b.questions.length > 0 && <Text style={s.h2}>Questions to answer</Text>}
        {b.questions.map((q, i) => (
          <View key={i} wrap={false}>
            <Text style={s.q}>{q.question}</Text>
            <Marked text={q.answer} />
          </View>
        ))}

        <Text style={s.h2}>Facts to use</Text>
        {b.facts.length ? (
          b.facts.map((f, i) => (
            <View key={i} style={s.row}>
              <Text style={s.bullet}>•</Text>
              <Text style={s.item}>
                {f.fact} <Text style={s.source}>(from &quot;{f.source}&quot;)</Text>
              </Text>
            </View>
          ))
        ) : (
          <Text>None found in your knowledge base.</Text>
        )}

        {b.gaps.length > 0 && <Text style={s.h2}>Still to add</Text>}
        {b.gaps.map((g, i) => (
          <Bullet key={i} text={g} />
        ))}

        {!!b.cluster?.length && <Text style={s.h2}>Related searches</Text>}
        {b.cluster?.map((c, i) => (
          <Bullet key={i} text={c} />
        ))}

      </Page>
    </Document>
  );
}

/** Render to a PDF buffer (react-pdf v4 returns a stream from toBuffer). */
export async function renderBriefPdf(props: BriefPdfProps): Promise<Buffer> {
  const stream = await pdf(BriefPDF(props)).toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
