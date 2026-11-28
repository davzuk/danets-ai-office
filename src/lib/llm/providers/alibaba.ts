// Alibaba Cloud Model Studio (Qwen) through its OpenAI-compatible
// Chat Completions API. A Model Studio API key only works in the region it
// was created in, so the base URL follows the chosen region.

import type { AiTask } from "../types";
import { createOpenAiCompatible } from "./openai";

export type AlibabaRegion = "singapore" | "us-virginia" | "beijing" | "hongkong" | "tokyo";

export const ALIBABA_REGIONS: Record<
  AlibabaRegion,
  { label: string; regionId: string; /** Shared domain, when the region has one. */ legacyHost: string | null }
> = {
  singapore: { label: "Singapore (international)", regionId: "ap-southeast-1", legacyHost: "dashscope-intl.aliyuncs.com" },
  "us-virginia": { label: "US (Virginia)", regionId: "us-east-1", legacyHost: null },
  beijing: { label: "China (Beijing)", regionId: "cn-beijing", legacyHost: "dashscope.aliyuncs.com" },
  hongkong: { label: "China (Hong Kong)", regionId: "cn-hongkong", legacyHost: "cn-hongkong.dashscope.aliyuncs.com" },
  tokyo: { label: "Japan (Tokyo)", regionId: "ap-northeast-1", legacyHost: null },
};

export const ALIBABA_REGION_IDS = Object.keys(ALIBABA_REGIONS) as AlibabaRegion[];

export function isAlibabaRegion(v: unknown): v is AlibabaRegion {
  return typeof v === "string" && Object.hasOwn(ALIBABA_REGIONS, v);
}

/** Workspace IDs are short lowercase letters, digits and dashes. */
export const WORKSPACE_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/i;

/**
 * The compatible-mode base URL for a region. Workspace-specific domains are
 * Alibaba's recommended endpoints; regions without a shared domain need one.
 * Returns null when the region needs a workspace ID and none was given.
 */
export function alibabaBaseUrl(region: AlibabaRegion, workspaceId?: string | null): string | null {
  const r = ALIBABA_REGIONS[region];
  const ws = workspaceId?.trim();
  if (ws && WORKSPACE_ID_RE.test(ws)) return `https://${ws.toLowerCase()}.${r.regionId}.maas.aliyuncs.com/compatible-mode/v1`;
  return r.legacyHost ? `https://${r.legacyHost}/compatible-mode/v1` : null;
}

/** Recommended Qwen text models (Model Studio, 2026-11). */
export const ALIBABA_MODELS = [
  { id: "qwen4-max", label: "Qwen4 Max: complex reasoning and writing" },
  { id: "qwen3.7-plus", label: "Qwen3.7 Plus: balanced speed and cost" },
  { id: "qwen3.8-flash", label: "Qwen3.8 Flash: fast and low cost" },
] as const;

/** Default model per task. Admins can override each one. */
export const ALIBABA_TASK_MODELS: Record<AiTask, string> = {
  chat: "qwen3.7-plus",
  classify: "qwen3.8-flash",
  extract: "qwen3.7-plus",
  content: "qwen3.7-plus",
  plan: "qwen4-max",
};

export const alibabaProvider = createOpenAiCompatible({
  id: "alibaba",
  label: "Alibaba Cloud",
  defaultBaseUrl: alibabaBaseUrl("singapore")!,
  dialect: "alibaba",
});
