import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("Seeding Danets AI Automation...");

  // Subscription plans
  const plans = [
    { name: "free", priceUsd: 0, chatLimit: 100, leadLimit: 50, kbLimit: 25, agentLimit: 1, auditRetentionDays: 7, chatRetentionDays: 30, leadRetentionDays: 90, features: JSON.stringify(["1 AI agent", "Basic analytics", "Chat widget"]) },
    { name: "starter", priceUsd: 29, chatLimit: 1000, leadLimit: 300, kbLimit: 100, agentLimit: 3, auditRetentionDays: 30, chatRetentionDays: 90, leadRetentionDays: 180, features: JSON.stringify(["3 AI agents", "Lead scoring", "Email support"]) },
    { name: "pro", priceUsd: 79, chatLimit: 5000, leadLimit: 1500, kbLimit: 500, agentLimit: 999, auditRetentionDays: 90, chatRetentionDays: 180, leadRetentionDays: 365, features: JSON.stringify(["Unlimited agents", "Quote generator", "Priority support", "Custom branding"]) },
    { name: "enterprise", priceUsd: 199, chatLimit: 50000, leadLimit: 20000, kbLimit: 5000, agentLimit: 9999, auditRetentionDays: 365, chatRetentionDays: 730, leadRetentionDays: 1095, features: JSON.stringify(["Everything in Pro", "Dedicated manager", "SLA", "API access", "Custom domain"]) },
  ];
  for (const p of plans) {
    await db.subscriptionPlan.upsert({
      where: { name: p.name },
      create: p,
      update: p,
    });
  }

  await db.platformConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      platformName: "Danets AI Automation",
      platformTagline: "AI-powered business automation",
      supportEmail: "hello@danetstecpro.com",
      supportPhone: "+234 800 000 0000",
      defaultSignupPlan: "free",
      emailFromName: "Danets AI",
      emailFromAddress: "noreply@danetstecpro.com",
    },
    update: {
      supportEmail: "hello@danetstecpro.com",
      supportPhone: "+234 800 000 0000",
    },
  });

  // Default business: Danets TecPro demo
  let business = await db.business.findFirst({ where: { email: "hello@danetstecpro.com" } });
  if (!business) {
    business = await db.business.create({
      data: {
        name: "Danets TecPro Limited",
        industry: "Software, Cloud, AI Automation & Cybersecurity",
        email: "hello@danetstecpro.com",
        phone: "+234 800 000 0000",
        whatsapp: "+2348000000000",
        plan: "pro",
        status: "active",
      },
    });
  }

  // Default admin user
  const email = "admin@danetstecpro.com";
  let user = await db.businessUser.findUnique({ where: { email } });
  if (!user) {
    const password = await bcrypt.hash("danets123", 10);
    user = await db.businessUser.create({
      data: {
        businessId: business.id,
        name: "Danets Admin",
        email,
        password,
        role: "admin",
      },
    });
  }

  // Super admin user (platform-wide access). Lives in the Danets tenant but
  // has the isSuperAdmin flag granting access to the Super Admin area.
  const saEmail = "superadmin@danetstecpro.com";
  const existingSa = await db.businessUser.findUnique({ where: { email: saEmail } });
  if (!existingSa) {
    const saPassword = await bcrypt.hash("super123", 10);
    await db.businessUser.create({
      data: {
        businessId: business.id,
        name: "Super Admin",
        email: saEmail,
        password: saPassword,
        role: "admin",
        isSuperAdmin: true,
      },
    });
  } else if (!existingSa.isSuperAdmin) {
    await db.businessUser.update({
      where: { email: saEmail },
      data: { isSuperAdmin: true },
    });
  }

  // Dedicated platform admin (Phase 5 auth realm)
  const paEmail = "superadmin@danetstecpro.com";
  const existingPa = await db.platformAdmin.findUnique({ where: { email: paEmail } });
  if (!existingPa) {
    const paPassword = await bcrypt.hash("super123", 10);
    await db.platformAdmin.create({
      data: {
        name: "Super Admin",
        email: paEmail,
        password: paPassword,
        homeBusinessId: business.id,
      },
    });
  } else if (!existingPa.homeBusinessId) {
    await db.platformAdmin.update({
      where: { email: paEmail },
      data: { homeBusinessId: business.id },
    });
  }

  // AI agent
  let agent = await db.aiAgent.findFirst({ where: { businessId: business.id } });
  if (!agent) {
    agent = await db.aiAgent.create({
      data: {
        businessId: business.id,
        botName: "Danets Assistant",
        businessName: business.name,
        industry: business.industry || "Technology",
        welcomeMessage: "Hi there! I'm the Danets AI Assistant. I can help with software, cloud, AI automation and cybersecurity solutions. How can I help your business today?",
        fallbackMessage: "I'm not fully sure about that. Please contact our team for confirmation.",
        handoverMessage: "I'll connect you with our team. You can reach us via WhatsApp, phone, or email below.",
        tone: "professional",
        contactPhone: business.phone || "",
        whatsappNumber: business.whatsapp || "",
        email: business.email || "",
        brandColor: "#1d4ed8",
        quickReplies: JSON.stringify([
          "What services do you offer?",
          "What are your pricing plans?",
          "How can I contact your team?",
          "Do you offer cybersecurity services?",
        ]),
        status: "active",
      },
    });
  }

  // Sample knowledge base
  const kbCount = await db.knowledgeBaseItem.count({ where: { businessId: business.id } });
  if (kbCount === 0) {
    const samples = [
      { title: "Company Overview", content: "Danets TecPro Limited provides Software, Cloud, AI Automation and Cybersecurity solutions for businesses. We help companies automate website chat, customer support, lead capture, quotation generation and business workflows using AI.", category: "About", sourceType: "manual" },
      { title: "AI Automation Services", content: "Our AI Automation product helps businesses automate customer support chat, capture leads 24/7, generate quotes and proposals, and streamline workflows. Pricing starts at $29/month for the Starter plan.", category: "Services", sourceType: "manual" },
      { title: "Cybersecurity Solutions", content: "We offer penetration testing, security audits, vulnerability assessments, and managed security services. Typical engagements start from $1,500. Contact us for a tailored quote.", category: "Services", sourceType: "manual" },
      { title: "Cloud Services", content: "We provide cloud migration, AWS/Azure/GCP architecture, DevOps automation, and managed cloud hosting. Cloud migration projects typically take 2-6 weeks depending on scope.", category: "Services", sourceType: "manual" },
      { title: "Business Hours", content: "Our support team is available Monday to Friday, 9am to 6pm (WAT). Chatbot support is available 24/7 for automated queries.", category: "Support", sourceType: "faq" },
      { title: "Contact Channels", content: "You can reach Danets TecPro via email at hello@danetstecpro.com, phone, or WhatsApp. Response time is typically within one business day.", category: "Support", sourceType: "faq" },
      { title: "Pricing & Plans", content: "Danets AI Automation plans: Free (100 chats/mo), Starter $29/mo (1000 chats), Pro $79/mo (5000 chats + quote generator), Enterprise $199/mo (custom). All plans include the chat widget and lead capture.", category: "Pricing", sourceType: "manual" },
    ];
    for (const s of samples) {
      await db.knowledgeBaseItem.create({ data: { businessId: business.id, ...s, status: "active" } });
    }
  }

  // Prompt templates
  const tplCount = await db.aiPromptTemplate.count({ where: { businessId: business.id } });
  if (tplCount === 0) {
    await db.aiPromptTemplate.createMany({
      data: [
        {
          businessId: business.id,
          name: "Chat System Prompt",
          type: "chat_system",
          content: "You are a helpful, {tone} AI assistant for {business_name} ({industry}). Answer visitor questions using ONLY the knowledge base provided. If the answer is not in the knowledge base, reply exactly: \"{fallback_message}\". Never invent prices, policies, or promises. Keep answers concise and professional. Offer to connect the visitor to a human via WhatsApp/phone/email when appropriate.",
        },
        {
          businessId: business.id,
          name: "Suggested Reply Generator",
          type: "suggested_reply",
          content: "Given this conversation between a visitor and an AI assistant, produce: 1) a short summary, 2) a suggested follow-up message the business team could send, 3) lead quality (low/medium/high), 4) recommended next action. Reply as strict JSON.",
        },
        {
          businessId: business.id,
          name: "Quote Proposal Generator",
          type: "quote",
          content: "You are a senior solutions consultant. Generate a professional project proposal based on the provided brief. Include: Project Summary, Scope of Work, Deliverables, Timeline, Pricing Guidance (as placeholder ranges), Terms and Conditions (placeholder), and Next Steps. Use markdown headings.",
        },
      ],
    });
  }

  // Default subscription record for demo business
  await db.businessSubscription.upsert({
    where: { businessId: business.id },
    create: {
      businessId: business.id,
      planName: business.plan,
      status: "active",
      monthlyFee: 79,
    },
    update: {
      planName: business.plan,
      status: "active",
    },
  });

  // Default platform feature flags
  const defaultFlags = [
    { key: "document_upload", name: "Document Upload", description: "Allow PDF/DOCX file upload in Document Assistant", enabled: true },
    { key: "whatsapp_live", name: "WhatsApp Live Sending", description: "Enable real WhatsApp message delivery", enabled: false },
    { key: "automations_engine", name: "Automation Engine", description: "Auto-execute workflow triggers", enabled: false },
    { key: "advanced_analytics", name: "Advanced Analytics", description: "Extended reports and deflection insights", enabled: true },
  ];
  for (const f of defaultFlags) {
    await db.platformFeatureFlag.upsert({
      where: { key: f.key },
      create: f,
      update: { name: f.name, description: f.description },
    });
  }

  // Enable pro-tier feature flags for the demo business
  const proFlags = ["whatsapp_live", "automations_engine"] as const;
  for (const flagKey of proFlags) {
    await db.businessFeatureFlag.upsert({
      where: { businessId_flagKey: { businessId: business.id, flagKey } },
      create: { businessId: business.id, flagKey, enabled: true },
      update: { enabled: true },
    });
  }

  console.log("Seed complete.");
  console.log("  Business:", business.name, "(", business.publicKey, ")");
  console.log("  Login:    admin@danetstecpro.com / danets123");
  console.log("  Platform: http://localhost:3000/platform (superadmin@danetstecpro.com / super123)");
  console.log("  Widget public key:", business.publicKey);

  // ─── CMS ─────────────────────────────────────────────────────────
  // Seed the marketing CMS: site settings, nav, block library, tags,
  // authors, a sample blog post and a sample home page. Safe to re-run
  // — every write is upsert/conditional.
  await seedCms();
}

/**
 * Populate the CMS with sensible defaults so the public marketing site
 * renders out-of-the-box. Idempotent — uses upsert and check-before-create.
 */
async function seedCms() {
  console.log("Seeding CMS…");

  // Site settings (singleton row)
  await db.cmsSite.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      brandName: "Danets AI Automation",
      tagline: "AI-powered business automation",
      description:
        "Automate customer chat, lead capture, quotes and workflows with AI. Built for businesses that want to scale without scaling headcount.",
      supportEmail: "hello@danetstecpro.com",
      logoUrl: null,
      faviconUrl: null,
      primaryColor: "#1d4ed8",
      accentColor: "#84cc16",
      socialLinks: {
        twitter: "https://twitter.com/danetstecpro",
        linkedin: "https://linkedin.com/company/danetstecpro",
        github: "https://github.com/danetstecpro",
      },
      seoDefaults: {
        title: "Danets AI Automation",
        description:
          "Automate customer chat, lead capture, quotes and workflows with AI.",
      },
    },
    update: {
      brandName: "Danets AI Automation",
      tagline: "AI-powered business automation",
      supportEmail: "hello@danetstecpro.com",
    },
  });

  // Default navigation
  const navCount = await db.cmsNavItem.count();
  if (navCount === 0) {
    const navRows = [
      { label: "Features", href: "/features", order: 0, visible: true, icon: null, parentId: null },
      { label: "Pricing", href: "/pricing", order: 1, visible: true, icon: null, parentId: null },
      { label: "Industries", href: "/industries", order: 2, visible: true, icon: null, parentId: null },
      { label: "Blog", href: "/blog", order: 3, visible: true, icon: null, parentId: null },
      { label: "Docs", href: "/docs", order: 4, visible: true, icon: null, parentId: null },
      { label: "Changelog", href: "/changelog", order: 5, visible: true, icon: null, parentId: null },
    ];
    for (const n of navRows) {
      await db.cmsNavItem.create({ data: n });
    }
  }

  // Block library (built-in blocks the renderer knows about)
  const blockDefs = [
    { key: "hero", label: "Hero", description: "Title + subtitle + CTAs", icon: "Rocket" },
    { key: "feature-grid", label: "Feature grid", description: "3-column feature list with icons", icon: "Grid3x3" },
    { key: "logo-cloud", label: "Logo cloud", description: "Customer / partner wordmarks", icon: "Sparkles" },
    { key: "testimonials", label: "Testimonials", description: "Customer quotes", icon: "Quote" },
    { key: "pricing-table", label: "Pricing table", description: "Live SubscriptionPlan rows", icon: "DollarSign" },
    { key: "faq", label: "FAQ", description: "Accordion of common questions", icon: "HelpCircle" },
    { key: "cta", label: "CTA banner", description: "Conversion-focused banner", icon: "Megaphone" },
    { key: "rich-text", label: "Rich text", description: "Markdown-safe prose block", icon: "Type" },
    { key: "stats", label: "Stats", description: "Big-number stat row", icon: "BarChart3" },
  ];
  for (const b of blockDefs) {
    await db.cmsBlock.upsert({
      where: { key: b.key },
      create: { ...b, schema: {}, defaultProps: {}, isActive: true },
      update: { label: b.label, description: b.description, icon: b.icon },
    });
  }

  // A couple of authors + tags for the blog
  const authorNames = ["Alex Rivera", "Priya Shah"];
  for (const name of authorNames) {
    const existing = await db.cmsAuthor.findFirst({ where: { name } });
    if (!existing) {
      await db.cmsAuthor.create({
        data: {
          name,
          bio: `${name} writes about AI, automation and growth at Danets TecPro.`,
          avatarUrl: null,
        },
      });
    }
  }

  const tagSlugs = [
    { slug: "product", name: "Product" },
    { slug: "engineering", name: "Engineering" },
    { slug: "ai", name: "AI" },
    { slug: "growth", name: "Growth" },
  ];
  for (const t of tagSlugs) {
    try {
      await db.cmsTag.create({ data: t });
    } catch {
      // unique constraint — already exists
    }
  }

  // Sample home page
  const homeExists = await db.cmsPage.findUnique({ where: { slug: "home" } });
  if (!homeExists) {
    await db.cmsPage.create({
      data: {
        slug: "home",
        title: "Home",
        description:
          "AI-powered chat, lead capture, quotes and workflows for modern businesses.",
        status: "published",
        publishedAt: new Date(),
        blocks: [
          {
            blockKey: "hero",
            props: {
              eyebrow: "AI AUTOMATION",
              title: "Automate the conversations that grow your business",
              highlight: "grow your business",
              subtitle:
                "Danets AI gives every visitor an instant, accurate answer — and turns the right ones into qualified leads with auto-generated quotes.",
              primaryCta: { label: "Get started free", href: "/signup" },
              secondaryCta: { label: "See it live", href: "/widget-demo" },
            },
          },
          {
            blockKey: "logo-cloud",
            props: {
              title: "Trusted by teams shipping at speed",
              logos: ["Acme Co", "Northwind", "Globex", "Initech", "Hooli", "Soylent"],
            },
          },
          {
            blockKey: "feature-grid",
            props: {
              title: "Everything you need to convert visitors",
              subtitle:
                "A single platform for chat, lead capture, quoting and workflow automation.",
              columns: 3,
              features: [
                { icon: "MessageSquare", title: "24/7 AI chat", body: "Answer every visitor question with your knowledge base, not a chatbot script." },
                { icon: "Target", title: "Smart lead capture", body: "Score and qualify leads in real time so your team focuses on the right ones." },
                { icon: "FileText", title: "Auto quotes", body: "Generate professional quotes from a conversation in seconds." },
                { icon: "Workflow", title: "Workflow automation", body: "Route hot leads to Slack, email or your CRM the moment they qualify." },
                { icon: "BarChart3", title: "Deflection analytics", body: "See what your AI handles vs. what reaches your team — and why." },
                { icon: "ShieldCheck", title: "Enterprise-grade security", body: "Encrypted at rest, hardened CSP, full audit log and SOC2-ready controls." },
              ],
            },
          },
          {
            blockKey: "stats",
            props: {
              stats: [
                { value: "10k+", label: "chats handled monthly" },
                { value: "3x", label: "more qualified leads" },
                { value: "< 60s", label: "quote turnaround" },
                { value: "99.9%", label: "uptime" },
              ],
            },
          },
          {
            blockKey: "testimonials",
            props: {
              title: "What customers say",
              items: [
                { quote: "Danets AI handles 80% of our inbound questions and books 3× more demos.", author: "Lena Park", role: "Head of Growth, Northwind" },
                { quote: "The quote generator alone paid for the platform in the first week.", author: "Marcus Lee", role: "Founder, Initech" },
                { quote: "Setup took an afternoon. Our team got evenings back.", author: "Priya Shah", role: "COO, Globex" },
              ],
            },
          },
          {
            blockKey: "pricing-table",
            props: { title: "Pricing that scales with you" },
          },
          {
            blockKey: "faq",
            props: {
              title: "Frequently asked questions",
              items: [
                { q: "Do I need to train the AI?", a: "No. The AI learns from your knowledge base articles and website content automatically." },
                { q: "What channels does the widget support?", a: "Web chat, WhatsApp, and email today. More channels on the roadmap." },
                { q: "Can I export my leads and conversations?", a: "Yes. CSV export and a full REST API are included on every paid plan." },
                { q: "Is my data isolated?", a: "Yes. Every tenant has its own database schema and encryption keys." },
              ],
            },
          },
          {
            blockKey: "cta",
            props: {
              title: "Ready to put your growth on autopilot?",
              subtitle: "Start free in under five minutes. No credit card required.",
              primaryCta: { label: "Get started", href: "/signup" },
              secondaryCta: { label: "Talk to sales", href: "/contact" },
              variant: "gradient",
            },
          },
        ],
        seo: {
          title: "Danets AI Automation",
          description:
            "Automate customer chat, lead capture, quotes and workflows with AI.",
        },
      },
    });
  }

  // Sample blog post
  const postExists = await db.cmsPost.findUnique({
    where: { slug: "introducing-danets-ai-automation" },
  });
  if (!postExists) {
    const author = await db.cmsAuthor.findFirst({ where: { name: "Alex Rivera" } });
    const aiTag = await db.cmsTag.findUnique({ where: { slug: "ai" } });
    await db.cmsPost.create({
      data: {
        slug: "introducing-danets-ai-automation",
        title: "Introducing Danets AI Automation",
        excerpt:
          "Today we're launching Danets AI Automation — a single platform for chat, leads, quotes and workflows.",
        coverImage: null,
        bodyMdx: `Today we're thrilled to announce **Danets AI Automation**, the platform we've been building for the last year.

## Why we built it

Every business we spoke to was stitching together a chat tool, a CRM, a quote generator, and a workflow automation tool — and paying for four subscriptions.

Danets brings all four into one product, with **AI in the middle** doing the boring parts.

## What's in the box

- **AI chat** trained on your own knowledge base
- **Smart lead capture** with real-time scoring
- **Auto-quote generation** from a conversation
- **Workflow automation** for routing and follow-up

## Try it

[Get started free](/signup) — no credit card required.
`,
        status: "published",
        publishedAt: new Date(),
        authorId: author?.id,
        tags: { connect: aiTag ? [{ id: aiTag.id }] : [] },
        seo: {
          title: "Introducing Danets AI Automation",
          description:
            "The single platform for chat, leads, quotes and workflow automation.",
        },
      },
    });
  }

  // First changelog entry
  const changeCount = await db.cmsChangelogEntry.count();
  if (changeCount === 0) {
    await db.cmsChangelogEntry.create({
      data: {
        version: "1.0.0",
        title: "Initial release",
        body: "First public release of the Danets AI Automation platform.",
        kind: "release",
        publishedAt: new Date(),
      },
    });
  }

  console.log("CMS seed complete.");
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
