import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/onboarding — returns the setup checklist progress for the business
export async function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const businessId = user.businessId;

    const [agent, kbCount, conversations, leads, embedViewed] = await Promise.all([
      db.aiAgent.findFirst({
        where: { businessId },
        select: {
          id: true,
          welcomeMessage: true,
          brandColor: true,
          tone: true,
          status: true,
        },
      }),
      db.knowledgeBaseItem.count({
        where: { businessId, status: "active" },
      }),
      db.chatSession.count({ where: { businessId } }),
      db.lead.count({ where: { businessId } }),
      db.aiUsageLog.count({ where: { businessId } }),
    ]);

    // Determine checklist completion
    const steps = [
      {
        id: "agent",
        title: "Configure your AI agent",
        description: "Set bot name, welcome message, and tone",
        completed: !!agent && !!agent.welcomeMessage && !!agent.tone,
        href: "agent" as const,
      },
      {
        id: "kb",
        title: "Add knowledge base articles",
        description: "Create at least 3 articles so the AI can answer questions",
        completed: kbCount >= 3,
        href: "knowledge" as const,
      },
      {
        id: "brand",
        title: "Customize your brand color",
        description: "Match the widget to your brand identity",
        completed: !!agent && agent.brandColor !== "#1d4ed8",
        href: "agent" as const,
      },
      {
        id: "embed",
        title: "Get your embed code",
        description: "Install the chatbot widget on your website",
        completed: embedViewed > 0, // proxy: if they've used AI, they likely tested
        href: "embed" as const,
      },
      {
        id: "test",
        title: "Test your chatbot",
        description: "Visit the widget demo and ask a question",
        completed: conversations > 0,
        href: "embed" as const,
      },
      {
        id: "lead",
        title: "Capture your first lead",
        description: "A visitor fills the lead form in the widget",
        completed: leads > 0,
        href: "leads" as const,
      },
    ];

    const completedCount = steps.filter((s) => s.completed).length;
    const totalCount = steps.length;
    const percentage = Math.round((completedCount / totalCount) * 100);
    const isComplete = completedCount === totalCount;

    return {
      steps,
      completedCount,
      totalCount,
      percentage,
      isComplete,
    };
  });
}
