import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { buildAgentSystemPrompt, detectHandoverRequest, detectLeadIntent } = await import("@/lib/agent-reply");
const {
  commentThreadKey,
  dmThreadKey,
  extractContactDetails,
  messageWindow,
  messagingText,
  parseComment,
  withAiDisclosure,
} = await import("@/lib/social/inbox");

const agent = {
  botName: "Ada",
  tone: "friendly",
  businessName: "Acme Dental",
  industry: "healthcare",
  fallbackMessage: "Please contact our team.",
  handoverMessage: "Connecting you to the team.",
  contactPhone: "+2348012345678",
  whatsappNumber: null,
  email: "hello@acme.example",
};
const kb = [{ id: "k1", title: "Opening hours", content: "Mon-Sat 9-5." }];

/** The prompt exactly as the widget route built it before the extraction. */
function legacyWidgetPrompt(detectedLang: string) {
  const tone = "warm, friendly and approachable";
  const kbContext = kb.map((k, i) => `### Article ${i + 1}: ${k.title}\n${k.content}`).join("\n\n");
  return `You are "${agent.botName}", a ${tone} AI assistant for ${agent.businessName}${`, a company in ${agent.industry}`}.

CRITICAL RULES — follow strictly:
1. Answer the visitor's question using ONLY the knowledge base articles provided below. Do NOT invent prices, policies, features, timelines, or promises.
2. If the answer is not contained in the knowledge base, reply EXACTLY with this sentence: "${agent.fallbackMessage}"
3. Keep answers concise (max 3-4 short paragraphs). Be clear and professional.
4. Never claim to be a human. You are an AI assistant.
5. If the visitor seems interested in a service, pricing, or wants to talk to someone, offer to connect them to the team and mention contact options (WhatsApp/phone/email) when relevant.
6. Respond in the SAME LANGUAGE the visitor is using. Detected language: ${detectedLang}.

KNOWLEDGE BASE:
${kbContext}

When handing over, use: "${agent.handoverMessage}"
Contact phone: ${agent.contactPhone}

Email: ${agent.email}

Now respond to the visitor's message.`;
}

describe("buildAgentSystemPrompt", () => {
  it("is byte-identical to the old widget prompt when there is no brand voice", () => {
    expect(buildAgentSystemPrompt({ agent, businessName: "Acme", kbItems: kb, detectedLang: "en" })).toBe(legacyWidgetPrompt("en"));
  });

  it("adds brand voice and channel rules only when given", () => {
    const p = buildAgentSystemPrompt({
      agent,
      businessName: "Acme",
      kbItems: [],
      detectedLang: "en",
      brandContext: "# Brand voice: Acme\n- Tone: warm",
      channel: "facebook_comment",
    });
    expect(p).toContain("BRAND VOICE (style and wording only");
    expect(p).toContain("CHANNEL: a PUBLIC comment");
    expect(p).toContain("(No relevant knowledge base articles found for this query.)");
    expect(p.indexOf("CHANNEL:")).toBeLessThan(p.indexOf("KNOWLEDGE BASE:"));
  });

  it("detects intent and handover requests", () => {
    expect(detectLeadIntent("How much is whitening?")).toBe(true);
    expect(detectLeadIntent("thanks!")).toBe(false);
    expect(detectHandoverRequest("can I talk to a person please")).toBe(true);
    expect(detectHandoverRequest("what time do you open")).toBe(false);
  });
});

describe("messageWindow", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it("is open for 24 h, human-agent only until 7 days, then closed", () => {
    expect(messageWindow(ago(2), now)).toEqual({ state: "open", closesAt: new Date(ago(2).getTime() + 24 * 3_600_000) });
    expect(messageWindow(ago(30), now).state).toBe("human_agent");
    expect(messageWindow(ago(24 * 7 + 1), now)).toEqual({ state: "closed", closesAt: null });
    expect(messageWindow(null, now).state).toBe("closed");
  });
});

describe("social event parsing", () => {
  it("reads message text, attachments and postbacks", () => {
    expect(messagingText({ message: { mid: "m", text: "hi" } })).toBe("hi");
    expect(messagingText({ message: { mid: "m", attachments: [{ type: "image" }, { type: "audio" }] } })).toBe("[image] [audio]");
    expect(messagingText({ postback: { title: "Get started", payload: "GS" } })).toBe("Get started");
  });

  it("threads Facebook comments under the top-level comment", () => {
    const top = parseComment("facebook_page", "C1", { comment_id: "C1", post_id: "P1", parent_id: "P1", message: "Price?", from: { id: "u1", name: "Ada" } });
    expect(top).toMatchObject({ rootId: "C1", postId: "P1", text: "Price?", authorName: "Ada" });
    const reply = parseComment("facebook_page", "C2", { comment_id: "C2", post_id: "P1", parent_id: "C1", message: "also me" });
    expect(reply.rootId).toBe("C1");
  });

  it("threads Instagram comments and replies", () => {
    expect(parseComment("instagram", "IC1", { id: "IC1", text: "Love it", from: { id: "ig9", username: "fan" }, media: { id: "M1" } })).toMatchObject({
      rootId: "IC1",
      mediaId: "M1",
      authorName: "fan",
    });
    expect(parseComment("instagram", "IC2", { id: "IC2", parent_id: "IC1", text: "+1" }).rootId).toBe("IC1");
  });

  it("uses distinct thread keys for DMs and comments", () => {
    expect(dmThreadKey("123")).not.toBe(commentThreadKey("123"));
  });
});

describe("extractContactDetails", () => {
  it("finds an email and a phone number in a message", () => {
    expect(extractContactDetails("Sure, it's ada@example.com or call +234 801 234 5678")).toEqual({
      email: "ada@example.com",
      phone: "+234 801 234 5678",
    });
    expect(extractContactDetails("Saturday at 10 works")).toEqual({ email: null, phone: null });
  });
});

describe("withAiDisclosure", () => {
  it("labels the first AI reply unless it already says it's an AI", () => {
    expect(withAiDisclosure("We open at 9.", true)).toBe("(AI assistant) We open at 9.");
    expect(withAiDisclosure("Hi, I'm Acme's AI assistant. We open at 9.", true)).toBe("Hi, I'm Acme's AI assistant. We open at 9.");
    expect(withAiDisclosure("We open at 9.", false)).toBe("We open at 9.");
  });
});
