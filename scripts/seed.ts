import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("Seeding Danets AI Automation...");

  // Subscription plans
  const plans = [
    { name: "free", priceUsd: 0, chatLimit: 100, leadLimit: 50, kbLimit: 25, features: JSON.stringify(["1 AI agent", "Basic analytics", "Chat widget"]) },
    { name: "starter", priceUsd: 29, chatLimit: 1000, leadLimit: 300, kbLimit: 100, features: JSON.stringify(["3 AI agents", "Lead scoring", "Email support"]) },
    { name: "pro", priceUsd: 79, chatLimit: 5000, leadLimit: 1500, kbLimit: 500, features: JSON.stringify(["Unlimited agents", "Quote generator", "Priority support", "Custom branding"]) },
    { name: "enterprise", priceUsd: 199, chatLimit: 50000, leadLimit: 20000, kbLimit: 5000, features: JSON.stringify(["Everything in Pro", "Dedicated manager", "SLA", "API access"]) },
  ];
  for (const p of plans) {
    await db.subscriptionPlan.upsert({
      where: { name: p.name },
      create: p,
      update: p,
    });
  }

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

  console.log("Seed complete.");
  console.log("  Business:", business.name, "(", business.publicKey, ")");
  console.log("  Login:    admin@danetstecpro.com / danets123");
  console.log("  Super:    superadmin@danetstecpro.com / super123");
  console.log("  Widget public key:", business.publicKey);
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
