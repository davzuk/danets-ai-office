import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("Seeding Danets AI Automation...");

  // Subscription plans
  const plans = [
    { name: "free", priceUsd: 0, chatLimit: 100, leadLimit: 50, kbLimit: 25, agentLimit: 1, auditRetentionDays: 7, chatRetentionDays: 30, leadRetentionDays: 90, features: JSON.stringify(["1 AI agent", "Basic analytics", "Chat widget"]) },
    { name: "starter", priceUsd: 29, chatLimit: 1000, leadLimit: 300, kbLimit: 100, agentLimit: 3, auditRetentionDays: 30, chatRetentionDays: 90, leadRetentionDays: 180, features: JSON.stringify(["3 AI agents", "Lead scoring", "Email support"]) },
    { name: "pro", priceUsd: 79, chatLimit: 5000, leadLimit: 1500, kbLimit: 500, agentLimit: 999, auditRetentionDays: 90, chatRetentionDays: 180, leadRetentionDays: 365, features: JSON.stringify(["Unlimited agents", "Quote generator", "Priority support", "Custom branding"]) },
    { name: "enterprise", priceUsd: 199, auditPageLimit: 1000, trackedKeywordLimit: 500, campaignLimit: 0, chatLimit: 50000, leadLimit: 20000, kbLimit: 5000, agentLimit: 9999, auditRetentionDays: 365, chatRetentionDays: 730, leadRetentionDays: 1095, features: JSON.stringify(["Everything in Pro", "Dedicated manager", "SLA", "API access", "Custom domain"]) },
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
    { key: "campaigns_hub", name: "Campaigns", description: "Campaign records, linked posts and forms, and campaign results (Phase 4).", enabled: false },
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

  // Seed the dedicated marketing pages (/pricing, /features, /about,
  // /industries). Their dedicated route components fetch the matching
  // CMS row and render its blocks; without these rows the dedicated
  // pages 404.
  await seedMarketingPages();
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

/**
 * Seed the four dedicated marketing pages (pricing, features, about,
 * industries). Each dedicated route renders whatever CMS page has the
 * matching slug, so without these rows the dedicated pages 404.
 */
async function seedMarketingPages() {
  const pages = [
    {
      slug: "pricing",
      title: "Pricing",
      description: "Simple, transparent pricing for the Danets AI Automation platform. Start free, upgrade as you grow.",
      blocks: [
        { blockKey: "hero", props: { eyebrow: "PRICING", title: "Simple pricing that grows with you", subtitle: "Start free. Upgrade when you need more conversations, more agents or custom branding. No surprise fees." } },
        { blockKey: "pricing-table", props: { title: "Plans for every stage", subtitle: "All plans include the chat widget, lead capture and the full REST API." } },
        { blockKey: "faq", props: {
          title: "Pricing questions",
          items: [
            { q: "Can I change plans anytime?", a: "Yes — upgrade, downgrade or cancel from your billing page at any time. Changes are pro-rated." },
            { q: "Do you offer discounts for nonprofits or startups?", a: "Yes. Reach out via the contact form and we will work something out." },
            { q: "What payment methods do you accept?", a: "Paystack and Flutterwave support cards, bank transfer and mobile money across Nigeria, Ghana, Kenya and South Africa. International cards via Stripe on request." },
            { q: "Is there a free trial of paid plans?", a: "Every paid plan has a 14-day money-back guarantee — try it risk-free." },
          ],
        } },
        { blockKey: "cta", props: {
          title: "Ready to put your growth on autopilot?",
          subtitle: "Start free in under five minutes. No credit card required.",
          primaryCta: { label: "Get started", href: "/signup" },
          secondaryCta: { label: "Talk to sales", href: "/contact" },
          variant: "gradient",
        } },
      ],
    },
    {
      slug: "features",
      title: "Features",
      description: "AI chat, lead capture, quote generation, WhatsApp automation, integrations, and more — all in one secure dashboard.",
      blocks: [
        { blockKey: "hero", props: { eyebrow: "FEATURES", title: "Everything you need to automate growth", subtitle: "A single platform for chat, lead capture, quoting and workflow automation — built so your team can focus on closing, not chasing." } },
        { blockKey: "feature-grid", props: {
          title: "Built for serious teams",
          subtitle: "Every feature is wired to the same underlying visitor intelligence — no disjointed dashboards.",
          columns: 3,
          features: [
            { icon: "MessageSquare", title: "AI chat on your site", body: "Drop a widget on any page. The AI answers from your knowledge base, your documents, and your approved quick replies." },
            { icon: "Target", title: "Smart lead capture", body: "Real-time lead scoring, automatic deduplication, and CRM sync. Route hot leads the moment they qualify." },
            { icon: "FileText", title: "Auto-generated quotes", body: "Conversations turn into professional quotes with line items, terms and an e-signature-ready PDF." },
            { icon: "Workflow", title: "Workflow automation", body: "Trigger Slack, email, WhatsApp, or webhook actions on lead events, quote status, ticket states and more." },
            { icon: "BarChart3", title: "Deflection analytics", body: "See exactly what your AI handles vs. what reaches your team — and why. Spot content gaps automatically." },
            { icon: "ShieldCheck", title: "Enterprise-grade security", body: "AES-256 encryption at rest, hardened CSP, SOC2-ready controls, full audit log, TOTP 2FA, per-tenant isolation." },
            { icon: "Globe", title: "Multi-channel", body: "Web chat today. WhatsApp and email tomorrow. One conversation history across every channel." },
            { icon: "Plug", title: "Integrations", body: "Slack, HubSpot, Zoho, Google Sheets, webhooks and a full REST API. Bring your stack." },
            { icon: "Users", title: "Team collaboration", body: "Role-based access, internal notes, handoffs and conversation assignments — your team works as one." },
          ],
        } },
        { blockKey: "cta", props: {
          title: "See it in action",
          subtitle: "Try the live widget demo — no signup required.",
          primaryCta: { label: "Open demo", href: "/widget-demo" },
          secondaryCta: { label: "Get started", href: "/signup" },
          variant: "gradient",
        } },
      ],
    },
    {
      slug: "about",
      title: "About",
      description: "Danets TecPro Limited builds AI automation tools for businesses that want to move faster.",
      blocks: [
        { blockKey: "hero", props: { eyebrow: "ABOUT", title: "Built by Danets TecPro Limited", subtitle: "We are a small team building AI automation tools that help businesses convert more visitors, answer more questions, and ship more proposals — without growing headcount." } },
        { blockKey: "stats", props: {
          stats: [
            { value: "2024", label: "founded" },
            { value: "12+", label: "team members" },
            { value: "40+", label: "business customers" },
            { value: "99.9%", label: "platform uptime" },
          ],
        } },
        { blockKey: "rich-text", props: {
          body: "**Our mission** is to make enterprise-grade AI automation accessible to every business — not just the ones with seven-figure budgets.\n\nWe believe that:\n\n* Great conversations convert,\n* Great software respects your time,\n* Great teams deserve tools that disappear in the background.\n\nThank you for considering Danets.",
        } },
        { blockKey: "cta", props: {
          title: "Want to work with us?",
          subtitle: "We are always looking for great engineers, designers and customer-success people.",
          primaryCta: { label: "See open roles", href: "/contact" },
          secondaryCta: { label: "Try the product", href: "/signup" },
          variant: "gradient",
        } },
      ],
    },
    {
      slug: "industries",
      title: "Industries",
      description: "See how businesses across industries use Danets AI Automation to capture leads, automate chat, and close deals.",
      blocks: [
        { blockKey: "hero", props: { eyebrow: "INDUSTRIES", title: "Built for the way your industry sells", subtitle: "From SaaS to healthcare to professional services, Danets adapts to the conversations your customers actually have." } },
        { blockKey: "feature-grid", props: {
          title: "Where teams use Danets",
          columns: 2,
          features: [
            { icon: "Cpu", title: "SaaS & software", body: "Answer technical questions from your docs, qualify trial signups, and route high-intent visitors to sales." },
            { icon: "ShoppingBag", title: "E-commerce", body: "Recommend products, recover abandoned carts, and capture post-purchase support queries." },
            { icon: "Briefcase", title: "Professional services", body: "Triage incoming requests, draft proposals, and book consultations without a human in the loop." },
            { icon: "GraduationCap", title: "Education", body: "Answer admissions questions 24/7, capture leads from prospective students, and route applications." },
            { icon: "HeartPulse", title: "Healthcare", body: "Triage symptoms, book appointments, and answer insurance questions — with full audit trails." },
            { icon: "Building2", title: "Real estate", body: "Pre-qualify buyers and renters, schedule viewings, and answer listing questions around the clock." },
          ],
        } },
        { blockKey: "cta", props: {
          title: "See it for your industry",
          subtitle: "Book a 20-minute demo and we will walk you through a tailored workflow.",
          primaryCta: { label: "Book demo", href: "/contact" },
          secondaryCta: { label: "Try the widget", href: "/widget-demo" },
          variant: "gradient",
        } },
      ],
    },
  ];

  for (const pg of pages) {
    const existing = await db.cmsPage.findUnique({ where: { slug: pg.slug } });
    if (existing) {
      console.log(`  · /${pg.slug} already exists — skipping`);
      continue;
    }
    await db.cmsPage.create({
      data: {
        slug: pg.slug,
        title: pg.title,
        description: pg.description,
        status: "published",
        publishedAt: new Date(),
        blocks: pg.blocks,
      },
    });
    console.log(`  · /${pg.slug} created`);
  }
}

// Backwards-compatible name for the older wrapper.
const seedCmsPages = seedMarketingPages;

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
