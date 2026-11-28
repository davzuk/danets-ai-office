import { Document, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { NextSteps, ReportBrand, ReportData } from "./report";

// The monthly SEO report as a PDF. Wears the tenant's white-label brand when
// it has one (name, colour, logo), so an agency can forward it to its client.

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 54, paddingHorizontal: 44, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.4 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  brandName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  logo: { height: 28, maxWidth: 140, objectFit: "contain" },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#111827", lineHeight: 1.2, marginBottom: 4 },
  sub: { fontSize: 10, color: "#6b7280", marginBottom: 4 },
  rule: { height: 3, width: 48, marginTop: 6, marginBottom: 14 },
  summary: { fontSize: 11, color: "#374151", marginBottom: 14 },
  h2: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: "#111827", marginTop: 14, marginBottom: 6 },
  tiles: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  tile: { width: "25%", paddingHorizontal: 4, marginBottom: 8 },
  tileBox: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 4, padding: 8 },
  tileLabel: { fontSize: 8.5, color: "#6b7280" },
  tileValue: { fontSize: 15, fontFamily: "Helvetica-Bold", color: "#111827", lineHeight: 1.2, marginTop: 3, marginBottom: 2 },
  tileChange: { fontSize: 8.5, color: "#6b7280", marginTop: 1 },
  table: { borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f3f4f6", paddingVertical: 3 },
  th: { fontSize: 8.5, color: "#6b7280", fontFamily: "Helvetica-Bold" },
  c1: { flex: 1, paddingRight: 6 },
  cN: { width: 62, textAlign: "right" },
  muted: { color: "#6b7280" },
  step: { flexDirection: "row", marginBottom: 8 },
  stepNum: { width: 18, height: 18, borderRadius: 9, color: "#ffffff", fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "center", paddingTop: 4, marginRight: 8 },
  stepTitle: { fontFamily: "Helvetica-Bold", marginBottom: 1 },
  note: { fontSize: 8.5, color: "#6b7280", marginTop: 4 },
  // A fixed absolute Text repeats on every page (a fixed View, or a render prop, didn't draw).
  footerLeft: { position: "absolute", bottom: 24, left: 44, right: 44, fontSize: 8, color: "#9ca3af" },
});

const n = (v: number) => Math.round(v).toLocaleString("en-GB");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
function change(cur: number, prev: number, unit = "") {
  if (!prev && !cur) return "no change";
  if (!prev) return "new this month";
  const d = cur - prev;
  const p = Math.round((d / prev) * 100);
  return `${d >= 0 ? "+" : ""}${n(d)}${unit} (${p >= 0 ? "+" : ""}${p}%) vs last month`;
}
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || u;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={s.tile}>
      <View style={s.tileBox}>
        <Text style={s.tileLabel}>{label}</Text>
        <Text style={s.tileValue}>{value}</Text>
        {sub ? <Text style={s.tileChange}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export interface ReportPdfProps {
  data: ReportData;
  nextSteps: NextSteps | null;
  brand: ReportBrand;
}

export function ReportPDF({ data: d, nextSteps, brand }: ReportPdfProps) {
  const title = `SEO report: ${monthLabel(d.month)}`;
  const search = d.search;
  return (
    <Document title={`${title} — ${d.businessName}`} author={brand.name} creator={brand.name} producer={brand.name}>
      <Page size="A4" style={s.page}>
        <Text style={s.footerLeft} fixed>
          {`${d.businessName} · ${monthLabel(d.month)}${brand.poweredBy ? " · Made with Danets AI Automation" : ""}`}
        </Text>
        <View style={s.head}>
          {brand.logo ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
            <Image style={s.logo} src={{ data: brand.logo.data, format: brand.logo.format }} />
          ) : (
            <Text style={[s.brandName, { color: brand.color }]}>{brand.name}</Text>
          )}
          <Text style={s.muted}>{d.businessName}</Text>
        </View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>
          {d.from} to {d.to}
          {search ? ` · ${shortUrl(search.siteUrl)}` : ""}
        </Text>
        <View style={[s.rule, { backgroundColor: brand.color }]} />
        {nextSteps?.summary ? <Text style={s.summary}>{nextSteps.summary}</Text> : null}

        <View style={s.tiles}>
          {search && <Tile label="Clicks from Google" value={n(search.totals.clicks)} sub={change(search.totals.clicks, search.previous.clicks)} />}
          {search && <Tile label="Impressions" value={n(search.totals.impressions)} sub={change(search.totals.impressions, search.previous.impressions)} />}
          {search && <Tile label="Average position" value={search.totals.impressions ? search.totals.position.toFixed(1) : "—"} sub={`CTR ${pct(search.totals.ctr)}`} />}
          <Tile label="Leads from organic search" value={n(d.leads.organic)} sub={change(d.leads.organic, d.leads.previous)} />
          {d.audit?.score != null && <Tile label="Site audit score" value={`${d.audit.score}/100`} sub={d.audit.previousScore != null ? `was ${d.audit.previousScore}` : undefined} />}
          {d.reviews && <Tile label="New reviews" value={n(d.reviews.count)} sub={change(d.reviews.count, d.reviews.previous)} />}
          {d.reviews && (
            <Tile label="Average rating" value={d.reviews.averageRating != null ? `${d.reviews.averageRating.toFixed(1)} / 5` : "—"} sub={d.reviews.overallRating != null ? `${d.reviews.overallRating.toFixed(1)} / 5 overall` : undefined} />
          )}
          {d.reviews && <Tile label="Reviews replied to" value={d.reviews.replyRate != null ? `${Math.round(d.reviews.replyRate * 100)}%` : "—"} sub={`${d.reviews.replied} of ${d.reviews.count}`} />}
        </View>
        {search && !search.complete && <Text style={s.note}>Search Console data for the end of the month wasn&apos;t in yet, so search numbers may rise slightly.</Text>}

        {nextSteps && (
          <View wrap={false}>
            <Text style={s.h2}>Do this next</Text>
            {nextSteps.steps.map((st, i) => (
              <View key={i} style={s.step}>
                <Text style={[s.stepNum, { backgroundColor: brand.color }]}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.stepTitle}>{st.title}</Text>
                  <Text>{st.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {search && (search.gainers.length > 0 || search.losers.length > 0) && (
          <View wrap={false}>
            <Text style={s.h2}>Top movers</Text>
            <View style={s.table}>
              <View style={s.tr}>
                <Text style={[s.th, s.c1]}>Search</Text>
                <Text style={[s.th, s.cN]}>Clicks</Text>
                <Text style={[s.th, s.cN]}>Change</Text>
                <Text style={[s.th, s.cN]}>Position</Text>
              </View>
              {[...search.gainers, ...search.losers].map((m) => (
                <View key={m.query} style={s.tr}>
                  <Text style={s.c1}>{m.query}</Text>
                  <Text style={s.cN}>{n(m.clicks)}</Text>
                  <Text style={[s.cN, { color: m.change > 0 ? "#047857" : "#b91c1c" }]}>
                    {m.change > 0 ? "+" : ""}
                    {n(m.change)}
                  </Text>
                  <Text style={s.cN}>{m.position ? m.position.toFixed(1) : "—"}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {search && search.topPages.length > 0 && (
          <View wrap={false}>
            <Text style={s.h2}>Top pages</Text>
            <View style={s.table}>
              <View style={s.tr}>
                <Text style={[s.th, s.c1]}>Page</Text>
                <Text style={[s.th, s.cN]}>Clicks</Text>
                <Text style={[s.th, s.cN]}>Impressions</Text>
                <Text style={[s.th, s.cN]}>Leads</Text>
              </View>
              {search.topPages.map((p) => (
                <View key={p.page} style={s.tr}>
                  <Text style={s.c1}>{shortUrl(p.page)}</Text>
                  <Text style={s.cN}>{n(p.clicks)}</Text>
                  <Text style={s.cN}>{n(p.impressions)}</Text>
                  <Text style={s.cN}>{n(p.leads)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {d.audit && (
          <View wrap={false}>
            <Text style={s.h2}>Site audit</Text>
            <Text>
              {shortUrl(d.audit.rootUrl)}: score {d.audit.score ?? "—"}/100 from {n(d.audit.pagesCrawled)} pages
              {d.audit.inMonth ? "" : " (latest audit, from before this month)"}.{" "}
              {d.audit.fixed == null ? "This is the site's first audit." : `${d.audit.fixed} issue${d.audit.fixed === 1 ? "" : "s"} fixed and ${d.audit.added ?? 0} new since the previous audit.`}
            </Text>
            {d.audit.top.map((t) => (
              <Text key={t.label} style={s.muted}>
                • {t.label} ({t.count})
              </Text>
            ))}
          </View>
        )}

        {d.local && (
          <View wrap={false}>
            <Text style={s.h2}>Google Business Profile</Text>
            <View style={s.tiles}>
              <Tile label="Views on Search and Maps" value={n(d.local.totals.searchViews + d.local.totals.mapsViews)} sub={change(d.local.totals.searchViews + d.local.totals.mapsViews, d.local.previous.searchViews + d.local.previous.mapsViews)} />
              <Tile label="Calls" value={n(d.local.totals.calls)} sub={change(d.local.totals.calls, d.local.previous.calls)} />
              <Tile label="Website clicks" value={n(d.local.totals.websiteClicks)} sub={change(d.local.totals.websiteClicks, d.local.previous.websiteClicks)} />
              <Tile label="Directions" value={n(d.local.totals.directions)} sub={change(d.local.totals.directions, d.local.previous.directions)} />
            </View>
          </View>
        )}

      </Page>
    </Document>
  );
}

/** Render to a PDF buffer (react-pdf v4 returns a stream from toBuffer). */
export async function renderReportPdf(props: ReportPdfProps): Promise<Buffer> {
  const stream = await pdf(ReportPDF(props)).toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
