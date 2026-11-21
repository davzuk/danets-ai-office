import { describe, expect, it } from "vitest";
import { linkedinAssets, linkedinProvider, linkedinScopes, orgUrn } from "@/lib/connections/providers/linkedin";
import { getConnectionProvider } from "@/lib/connections/registry";
import { classifyLinkedInError, linkedinClient, publishToLinkedIn, toLittleText } from "@/lib/social/publish/linkedin";
import type { FetchLike } from "@/lib/social/publish/meta-http";
import { formIdFromVersionedUrn, linkedinFieldData, linkedinLeadInput, questionKey, toFormData, type LinkedInForm } from "@/lib/social/linkedin-leads";
import { mapLeadFields } from "@/lib/social/meta-leads";

const env = { LINKEDIN_CLIENT_ID: "cid", LINKEDIN_CLIENT_SECRET: "secret", LINKEDIN_API_VERSION: "202610" };

describe("LinkedIn provider", () => {
  it("is registered and builds the consent URL", () => {
    expect(getConnectionProvider("linkedin")).toBe(linkedinProvider);
    expect(linkedinProvider.isConfigured(env)).toBe(true);
    const url = new URL(linkedinProvider.authorizeUrl({ state: "s1", redirectUri: "https://app.test/cb", env }));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(url.searchParams.get("scope")).toContain("w_organization_social");
    expect(url.searchParams.get("scope")).not.toContain("r_marketing_leadgen_automation");
    expect(linkedinScopes({ ...env, LINKEDIN_LEAD_SYNC: "true" })).toContain("r_marketing_leadgen_automation");
  });

  it("turns approved admin ACLs into Page accounts", () => {
    const assets = linkedinAssets(
      [
        { organization: "urn:li:organization:42", role: "ADMINISTRATOR", state: "APPROVED" },
        { organization: "urn:li:organization:42", role: "ADMINISTRATOR", state: "APPROVED" },
        { organization: "urn:li:organization:7", role: "ADMINISTRATOR", state: "REQUESTED" },
      ],
      new Map([["42", { localizedName: "Acme", vanityName: "acme" }]])
    );
    expect(assets).toEqual([
      expect.objectContaining({ platform: "linkedin_page", externalId: "42", name: "Acme", username: "acme", accessToken: null }),
    ]);
    expect(orgUrn("42")).toBe("urn:li:organization:42");
  });
});

describe("LinkedIn publishing", () => {
  it("escapes little-text and templates hashtags", () => {
    expect(toLittleText("Open (9-5) #SmallBiz_2026 @ home")).toBe("Open \\(9-5\\) {hashtag|\\#|SmallBiz_2026} \\@ home");
  });

  it("classifies errors", () => {
    expect(classifyLinkedInError(401, {}).kind).toBe("auth");
    expect(classifyLinkedInError(403, { message: "Not enough permissions to access: posts.CREATE" }).kind).toBe("auth");
    expect(classifyLinkedInError(429, {}).kind).toBe("retry");
    expect(classifyLinkedInError(503, {}).kind).toBe("retry");
    expect(classifyLinkedInError(422, { message: "Content is a duplicate" })).toMatchObject({ kind: "content", message: "Content is a duplicate" });
  });

  function fake() {
    const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ method: init?.method ?? "GET", url, headers, body });
      if (url.includes("/images?action=initializeUpload")) {
        const n = calls.filter((c) => c.url.includes("initializeUpload")).length;
        return Response.json({ value: { uploadUrl: `https://upload.test/${n}`, image: `urn:li:image:${n}` } });
      }
      if (url.startsWith("https://upload.test/")) return new Response(null, { status: 201 });
      if (url.endsWith("/rest/posts")) return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:99" } });
      return new Response(JSON.stringify({ message: "no route" }), { status: 404 });
    };
    return { calls, client: linkedinClient("tok", env, fetchImpl) };
  }

  it("posts text with a link card as the organization", async () => {
    const { calls, client } = fake();
    const r = await publishToLinkedIn(client, { externalId: "42", text: "Hello #news", linkUrl: "https://acme.test/a", linkTitle: "Post", media: [], readMedia: async () => new Uint8Array() });
    expect(r).toEqual({ externalPostId: "urn:li:share:99", permalink: "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A99/" });
    const post = calls.find((c) => c.url.endsWith("/rest/posts"))!;
    expect(post.headers["LinkedIn-Version"]).toBe("202610");
    expect(post.headers.Authorization).toBe("Bearer tok");
    expect(post.body).toMatchObject({
      author: "urn:li:organization:42",
      commentary: "Hello {hashtag|\\#|news}",
      lifecycleState: "PUBLISHED",
      content: { article: { source: "https://acme.test/a", title: "Post" } },
    });
  });

  it("uploads images and posts them as a multi-image post", async () => {
    const { calls, client } = fake();
    const img = (n: number) => ({ kind: "image", url: `https://cdn.test/${n}.png`, mimeType: "image/png", altText: n === 1 ? "first" : null });
    await publishToLinkedIn(client, { externalId: "42", text: "Two", linkUrl: null, linkTitle: "", media: [img(1), img(2)], readMedia: async () => new Uint8Array([1, 2, 3]) });
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2);
    expect(calls.find((c) => c.url.endsWith("/rest/posts"))!.body).toMatchObject({
      content: { multiImage: { images: [{ id: "urn:li:image:1", altText: "first" }, { id: "urn:li:image:2" }] } },
    });
  });
});

describe("LinkedIn leads", () => {
  const form: LinkedInForm = {
    id: 123,
    name: "Demo request",
    state: "PUBLISHED",
    content: {
      questions: [
        { questionId: 1, predefinedField: "FIRST_NAME", question: { localized: { en_US: "First name" } } },
        { questionId: 2, predefinedField: "LAST_NAME", question: { localized: { en_US: "Last name" } } },
        { questionId: 3, predefinedField: "EMAIL", question: { localized: { en_US: "Email" } } },
        { questionId: 4, predefinedField: "COMPANY_NAME", question: { localized: { en_US: "Company" } } },
        {
          questionId: 5,
          question: { localized: { en_US: "Team size" } },
          questionDetails: { multipleChoiceQuestionDetails: { options: [{ id: 1, text: { localized: { en_US: "1-10" } } }] } },
        },
      ],
    },
  };
  const lead = {
    id: "resp-1",
    submittedAt: Date.parse("2026-11-20T10:00:00Z"),
    leadType: "SPONSORED",
    versionedLeadGenFormUrn: "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:123,2)",
    formResponse: {
      answers: [
        { questionId: 1, answerDetails: { textQuestionAnswer: { answer: "Ada" } } },
        { questionId: 2, answerDetails: { textQuestionAnswer: { answer: "Obi" } } },
        { questionId: 3, answerDetails: { textQuestionAnswer: { answer: "Ada@Example.com" } } },
        { questionId: 4, answerDetails: { textQuestionAnswer: { answer: "Obi Ltd" } } },
        { questionId: 5, answerDetails: { multipleChoiceAnswer: { options: [1] } } },
      ],
      hiddenFields: [{ name: "li_fat_id", value: "abc123" }],
    },
    leadMetadata: { sponsoredLeadMetadata: { campaign: "urn:li:sponsoredCampaign:555" } },
  };

  it("maps answers through the shared field mapping", () => {
    expect(formIdFromVersionedUrn(lead.versionedLeadGenFormUrn)).toBe("123");
    expect(questionKey({ predefinedField: "PHONE_NUMBER" })).toBe("phone_number");
    const mapped = mapLeadFields(linkedinFieldData(lead, form), {}, toFormData("123", form).questions);
    expect(mapped).toMatchObject({ name: "Ada Obi", email: "ada@example.com", company: "Obi Ltd", message: "Team size: 1-10" });
  });

  it("builds the import input with attribution", () => {
    const input = linkedinLeadInput(lead, form);
    expect(input).toMatchObject({
      externalRef: "linkedin:resp-1",
      identityType: "linkedin_lead",
      touchKey: "linkedin-lead:resp-1",
      channel: "social_paid",
      network: "LinkedIn",
      formRef: "123",
      touch: { source: "linkedin", medium: "paid_social", campaign: "linkedin-campaign-555", clickId: "abc123", clickIdType: "li_fat_id" },
    });
    expect(input.occurredAt.toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });
});
