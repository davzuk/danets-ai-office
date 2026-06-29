// Quick script to seed a sample chat session + messages for the demo business,
// so the Conversations view and suggestions endpoint have data to work with.
import { db } from "../src/lib/db";

async function main() {
  const business = await db.business.findFirst({
    where: { email: "hello@danetstecpro.com" },
  });
  if (!business) {
    console.error("Seeded business not found.");
    process.exit(1);
  }
  const agent = await db.aiAgent.findFirst({
    where: { businessId: business.id },
  });

  const now = Date.now();
  const baseDate = new Date(now - 1000 * 60 * 30); // 30 min ago

  const session = await db.chatSession.create({
    data: {
      businessId: business.id,
      agentId: agent?.id || null,
      visitorName: "Ada Okafor",
      visitorEmail: "ada.okafor@example.com",
      visitorPhone: "+234 803 555 0192",
      visitorId: "test-visitor-001",
      status: "active",
      createdAt: baseDate,
      updatedAt: new Date(now - 1000 * 60 * 2),
    },
  });

  const messages = [
    {
      role: "assistant",
      content:
        "Hi there! I'm the Danets AI Assistant. I can help with software, cloud, AI automation and cybersecurity solutions. How can I help your business today?",
      offset: 0,
    },
    {
      role: "user",
      content:
        "Hi, I run a small logistics company in Lagos. We need help automating our customer support and tracking shipments. Do you offer custom chatbots?",
      offset: 60_000,
    },
    {
      role: "assistant",
      content:
        "Absolutely! We build custom AI chatbots that handle customer FAQs, track shipments in real time, and capture leads 24/7. Our Starter plan begins at $29/month. Would you like a tailored quote for a logistics-focused setup?",
      offset: 120_000,
    },
    {
      role: "user",
      content:
        "Yes please. We get around 200 customer queries a day and currently use WhatsApp. Budget is around $200/month. Timeline is 3-4 weeks if possible.",
      offset: 180_000,
    },
    {
      role: "assistant",
      content:
        "Perfect — that fits well within our Pro plan ($79/month, 5000 chats). I'll have a consultant email you a tailored proposal within 24 hours. Could you confirm your email and a good time to call?",
      offset: 240_000,
    },
    {
      role: "user",
      content:
        "Email is ada.okafor@example.com. Best to call after 2pm WAT weekdays. Thanks!",
      offset: 300_000,
    },
  ];

  for (const m of messages) {
    await db.chatMessage.create({
      data: {
        sessionId: session.id,
        role: m.role,
        content: m.content,
        createdAt: new Date(baseDate.getTime() + m.offset),
      },
    });
  }

  // Attach a lead
  await db.lead.create({
    data: {
      businessId: business.id,
      sessionId: session.id,
      name: "Ada Okafor",
      email: "ada.okafor@example.com",
      phone: "+234 803 555 0192",
      service: "AI Chatbot + Customer Support Automation",
      message: "Logistics company, ~200 queries/day, WhatsApp, budget $200/mo, 3-4 week timeline",
      quality: "high",
      status: "new",
      source: "chatbot",
    },
  });

  // Bump session.updatedAt so it sorts first
  await db.chatSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date(now - 60_000) },
  });

  console.log("Seeded chat session:", session.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
