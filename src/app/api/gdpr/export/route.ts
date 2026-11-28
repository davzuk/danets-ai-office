import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export async function GET(_req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const businessId = user.businessId;

  const [business, users, aiAgents, knowledgeBase, chatSessions, leads, tickets, quoteRequests, documents, automationWorkflows, notifications, activityLogs, payments, invoices, contacts, touchpoints, socialAccounts, metaLeadForms, mediaAssets, contentPosts, scheduledPosts, postMetrics, accountMetrics, contentInsights, leadForms, formSubmissions, leadMagnets, searchProperties, businessLocations, seoSettings, siteAudits, gbpReviews, reviewRequests, gbpDailyMetrics, trackedKeywords, seoOpportunities, contentBriefs, seoReports] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, email: true, industry: true, phone: true, whatsapp: true, plan: true, status: true, createdAt: true } }),
    db.businessUser.findMany({ where: { businessId }, select: { id: true, name: true, email: true, role: true, createdAt: true } }),
    db.aiAgent.findMany({ where: { businessId }, select: { id: true, botName: true, tone: true, status: true } }),
    db.knowledgeBaseItem.findMany({ where: { businessId }, select: { id: true, title: true, category: true, status: true, createdAt: true } }),
    db.chatSession.findMany({ where: { businessId }, select: { id: true, visitorName: true, visitorEmail: true, status: true, createdAt: true } }),
    db.lead.findMany({ where: { businessId }, select: { id: true, name: true, email: true, phone: true, service: true, quality: true, status: true, leadScore: true, dealValue: true, createdAt: true } }),
    db.supportTicket.findMany({ where: { businessId }, select: { id: true, subject: true, status: true, priority: true, customerName: true, createdAt: true } }),
    db.quoteRequest.findMany({ where: { businessId }, select: { id: true, clientName: true, service: true, status: true, total: true, createdAt: true } }),
    db.document.findMany({ where: { businessId }, select: { id: true, title: true, category: true, sourceType: true, createdAt: true } }),
    db.automationWorkflow.findMany({ where: { businessId }, select: { id: true, name: true, triggerType: true, actionType: true, isActive: true, runCount: true } }),
    db.notification.findMany({ where: { businessId }, select: { id: true, type: true, title: true, message: true, readAt: true, createdAt: true } }),
    db.activityLog.findMany({ where: { businessId }, select: { id: true, action: true, module: true, description: true, userName: true, ipAddress: true, createdAt: true } }),
    db.payment.findMany({ where: { businessId }, select: { id: true, amount: true, currency: true, provider: true, reference: true, status: true, paidAt: true } }),
    db.invoice.findMany({ where: { businessId }, select: { id: true, invoiceNumber: true, amount: true, currency: true, status: true, paidAt: true } }),
    db.contact.findMany({ where: { businessId }, include: { identities: { select: { type: true, value: true, createdAt: true } } } }),
    db.touchpoint.findMany({ where: { businessId }, omit: { dedupeKey: true } }),
    db.socialAccount.findMany({ where: { businessId }, omit: { accessToken: true } }),
    db.metaLeadForm.findMany({ where: { businessId } }),
    db.mediaAsset.findMany({ where: { businessId }, omit: { storageKey: true } }),
    db.contentPost.findMany({ where: { businessId }, include: { variants: true } }),
    db.scheduledPost.findMany({ where: { businessId }, omit: { containerId: true, jobId: true } }),
    db.postMetric.findMany({ where: { businessId }, omit: { raw: true } }),
    db.accountMetric.findMany({ where: { businessId } }),
    db.contentInsight.findMany({ where: { businessId } }),
    db.leadFormDef.findMany({ where: { businessId } }),
    db.formSubmission.findMany({ where: { businessId }, omit: { ipHash: true } }),
    db.leadMagnet.findMany({ where: { businessId }, omit: { fileKey: true } }),
    db.searchProperty.findMany({ where: { businessId } }),
    db.businessLocation.findMany({ where: { businessId } }),
    db.seoSettings.findUnique({ where: { businessId } }),
    db.siteAudit.findMany({ where: { businessId }, omit: { state: true }, include: { issues: true } }),
    db.gbpReview.findMany({ where: { businessId } }),
    db.reviewRequest.findMany({ where: { businessId } }),
    db.gbpDailyMetric.findMany({ where: { businessId } }),
    db.trackedKeyword.findMany({ where: { businessId } }),
    db.seoOpportunity.findMany({ where: { businessId } }),
    db.contentBrief.findMany({ where: { businessId } }),
    db.seoReport.findMany({ where: { businessId } }),
  ]);

  await logActivity({ businessId, userId: user.userId, userName: user.name, action: "business_settings_changed", module: "business", description: "GDPR data export requested" });

  const exportData = { exportedAt: new Date().toISOString(), exportedBy: user.name, business, users, aiAgents, knowledgeBase, chatSessions, leads, tickets, quoteRequests, documents, automationWorkflows, notifications, activityLogs, payments, invoices, contacts, touchpoints, socialAccounts, metaLeadForms, mediaAssets, contentPosts, scheduledPosts, postMetrics, accountMetrics, contentInsights, leadForms, formSubmissions, leadMagnets, searchProperties, businessLocations, seoSettings, siteAudits, gbpReviews, reviewRequests, gbpDailyMetrics, trackedKeywords, seoOpportunities, contentBriefs, seoReports };
  return new NextResponse(JSON.stringify(exportData, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="danets-data-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
}
