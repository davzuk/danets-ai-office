import { z } from "zod";
import { createNotification } from "@/lib/activity";
import { AiOutputParseError, AiRefusalError } from "@/lib/llm";
import {
  BrandSourceError,
  generateBrandProfile,
  saveGeneratedBrandProfile,
  setGenerationStatus,
} from "@/lib/brand";
import { defineJob, NonRetryableError } from "../define";

const MAX_ATTEMPTS = 3;

/** Draft the tenant's Brand Voice from their KB + agent settings, then ask an admin to review. */
export const brandGenerateJob = defineJob({
  type: "brand.generate",
  schema: z.object({ businessId: z.string() }),
  maxAttempts: MAX_ATTEMPTS,
  timeoutMs: 5 * 60_000,
  async handler({ businessId }, ctx) {
    await setGenerationStatus(businessId, "running");
    try {
      const draft = await generateBrandProfile(businessId);
      await saveGeneratedBrandProfile(businessId, draft);
    } catch (e) {
      // Refusals, missing sources and malformed output won't improve on retry.
      const permanent = e instanceof BrandSourceError || e instanceof AiRefusalError || e instanceof AiOutputParseError;
      const final = permanent || ctx.attempt >= MAX_ATTEMPTS;
      const message = e instanceof BrandSourceError ? e.message : "The AI couldn't draft your brand voice. Please try again.";
      await setGenerationStatus(businessId, final ? "failed" : "queued", message);
      throw permanent ? new NonRetryableError((e as Error).message) : e;
    }

    await createNotification({
      businessId,
      type: "brand_profile_ready",
      title: "Brand voice draft ready",
      message: "Review and edit the AI-drafted brand voice in Settings before it's used for content.",
      data: { view: "settings" },
    });
  },
});
