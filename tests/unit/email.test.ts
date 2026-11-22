import { describe, expect, it } from "vitest";
import { emailSubject, emailTemplate, escapeHtml, renderNotificationEmail } from "@/lib/email";

const evil = `<img src=x onerror="alert(1)">`;

describe("notification emails", () => {
  it("escapes lead-supplied values in the HTML", () => {
    const r = renderNotificationEmail("new_lead", { leadName: evil, service: "<b>SEO</b>", quality: "high" })!;
    expect(r.html).not.toContain("<img");
    expect(r.html).not.toContain("<b>SEO");
    expect(r.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(r.html).toContain("&lt;b&gt;SEO&lt;/b&gt;");
  });

  it("escapes every template argument", () => {
    const html = emailTemplate(evil, evil, [{ label: evil, value: evil }], evil, `"><script>`);
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain('href="&quot;&gt;&lt;script&gt;"');
  });

  it("escapes AI-written insight text once", () => {
    const r = renderNotificationEmail("content_insight", { headline: "Views up 20% & leads <3", ideas: ["Tips & tricks"] })!;
    expect(r.html).toContain("Views up 20% &amp; leads &lt;3");
    expect(r.html).toContain("Tips &amp; tricks");
    expect(r.html).not.toContain("&amp;amp;");
    expect(r.text).toContain("- Tips & tricks");
  });

  it("keeps subjects to one line and placeholders literal", () => {
    expect(emailSubject("New lead captured: {leadName}", { leadName: "Ada\r\nBcc: victim@example.com" })).toBe(
      "New lead captured: Ada Bcc: victim@example.com"
    );
    expect(emailSubject("New lead captured: {leadName}", { leadName: "$& $1 Co" })).toBe("New lead captured: $& $1 Co");
    expect(emailSubject("Proposal accepted! {clientName}", { proposalClientName: "Acme" })).toBe("Proposal accepted! Acme");
    expect(emailSubject("Hi {leadName}", {})).toBe("Hi");
  });

  it("returns null for types without an email", () => {
    expect(renderNotificationEmail("content_review", {})).toBeNull();
    expect(escapeHtml(`a'b`)).toBe("a&#39;b");
  });
});
