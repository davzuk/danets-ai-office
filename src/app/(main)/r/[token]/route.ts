import { NextRequest, NextResponse } from "next/server";
import { followReviewLink, isGoogleUrl } from "@/lib/seo/review-requests";
import { logger, serializeError } from "@/lib/logger";

// GET /r/{token}: the short link in a review request. Counts the click and
// sends the person on to the location's Google review form.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let target: string | null = null;
  try {
    target = await followReviewLink(token);
  } catch (e) {
    logger.error("Review link failed", serializeError(e));
  }
  if (!target || !isGoogleUrl(target)) {
    return new NextResponse("This review link has expired.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return NextResponse.redirect(target, { status: 302, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
