"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

// Parse simple markdown into structured blocks for PDF rendering
interface Block {
  type: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "quote";
  text?: string;
  items?: string[];
}

function parseMarkdown(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "h3", text: trimmed.slice(4).replace(/\*\*/g, "") });
      i++;
    } else if (trimmed.startsWith("## ")) {
      blocks.push({ type: "h2", text: trimmed.slice(3).replace(/\*\*/g, "") });
      i++;
    } else if (trimmed.startsWith("# ")) {
      blocks.push({ type: "h1", text: trimmed.slice(2).replace(/\*\*/g, "") });
      i++;
    } else if (trimmed.startsWith("> ")) {
      blocks.push({ type: "quote", text: trimmed.slice(2) });
      i++;
    } else if (/^[-*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s/, "").replace(/\*\*/g, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
    } else if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, "").replace(/\*\*/g, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
    } else {
      blocks.push({ type: "p", text: trimmed.replace(/\*\*/g, "") });
      i++;
    }
  }
  return blocks;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 60,
    paddingHorizontal: 50,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: "#1a1a2e",
    lineHeight: 1.6,
  },
  header: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: "#1d4ed8",
  },
  brand: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1d4ed8",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 9,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1a1a2e",
    marginTop: 12,
    marginBottom: 4,
  },
  meta: {
    fontSize: 9,
    color: "#6b7280",
    marginBottom: 8,
  },
  h1: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#1d4ed8",
    marginTop: 16,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  h2: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#1e40af",
    marginTop: 14,
    marginBottom: 5,
  },
  h3: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#374151",
    marginTop: 10,
    marginBottom: 4,
  },
  p: {
    marginBottom: 6,
    textAlign: "justify",
  },
  ulItem: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 8,
  },
  bullet: {
    width: 12,
    color: "#1d4ed8",
    fontWeight: "bold",
  },
  olItem: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 8,
  },
  number: {
    width: 18,
    color: "#1d4ed8",
    fontWeight: "bold",
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: "#84cc16",
    paddingLeft: 12,
    marginBottom: 8,
    fontStyle: "italic",
    color: "#4b5563",
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

export function ProposalPDF({
  title,
  clientName,
  businessName,
  date,
  content,
}: {
  title: string;
  clientName: string;
  businessName: string;
  date: string;
  content: string;
}) {
  const blocks = parseMarkdown(content);

  return (
    <Document
      title={`${title} - ${clientName}`}
      author={businessName}
    >
      <Page size="A4" style={styles.page}>
        {/* Letterhead */}
        <View style={styles.header}>
          <Text style={styles.brand}>Danets AI Automation</Text>
          <Text style={styles.subtitle}>{businessName} · Professional Proposal</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>
            Prepared for: {clientName}   |   Date: {date}
          </Text>
        </View>

        {/* Content blocks */}
        {blocks.map((block, idx) => {
          if (block.type === "h1")
            return <Text key={idx} style={styles.h1}>{block.text}</Text>;
          if (block.type === "h2")
            return <Text key={idx} style={styles.h2}>{block.text}</Text>;
          if (block.type === "h3")
            return <Text key={idx} style={styles.h3}>{block.text}</Text>;
          if (block.type === "quote")
            return <Text key={idx} style={styles.quote}>{block.text}</Text>;
          if (block.type === "p")
            return <Text key={idx} style={styles.p}>{block.text}</Text>;
          if (block.type === "ul")
            return (
              <View key={idx}>
                {block.items?.map((item, i) => (
                  <View key={i} style={styles.ulItem}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={{ flex: 1 }}>{item}</Text>
                  </View>
                ))}
              </View>
            );
          if (block.type === "ol")
            return (
              <View key={idx}>
                {block.items?.map((item, i) => (
                  <View key={i} style={styles.olItem}>
                    <Text style={styles.number}>{i + 1}.</Text>
                    <Text style={{ flex: 1 }}>{item}</Text>
                  </View>
                ))}
              </View>
            );
          return null;
        })}

        {/* Footer */}
        <Text style={styles.footer} fixed>
          Generated by Danets AI Automation · {businessName} · Confidential
        </Text>
      </Page>
    </Document>
  );
}
