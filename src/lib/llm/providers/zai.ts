// Legacy provider: the z-ai-web-dev-sdk the app used before the provider
// layer existed. Kept as the last-resort fallback when no Anthropic key or
// tenant integration is configured.

import ZAI from "z-ai-web-dev-sdk";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "../types";

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getZai() {
  if (!zaiInstance) zaiInstance = await ZAI.create();
  return zaiInstance;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildMessages(req: ProviderRequest) {
  let system = req.system ?? "";
  if (req.jsonSchema) {
    // No server-side schema enforcement: instruct, then validate client-side.
    system +=
      `${system ? "\n\n" : ""}Respond with a single JSON value matching this JSON schema, ` +
      `and nothing else (no markdown fences, no commentary):\n${JSON.stringify(req.jsonSchema)}`;
  }
  const out: { role: string; content: string }[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of req.messages) out.push(m);
  return out;
}

async function run(req: ProviderRequest): Promise<ProviderResponse> {
  const zai = await getZai();
  const messages = buildMessages(req);
  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => ({ role: m.role as any, content: m.content })),
    thinking: { type: "disabled" },
    temperature: req.temperature,
  } as any);

  const content: string = completion.choices[0]?.message?.content || "";
  const usage = (completion as any).usage;
  const promptTokens = usage?.prompt_tokens ?? estimateTokens(messages.map((m) => m.content).join(""));
  const completionTokens = usage?.completion_tokens ?? estimateTokens(content);
  return {
    content,
    model: req.model,
    stopReason: "end",
    promptTokens,
    completionTokens,
    totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export const zaiProvider: ProviderAdapter = {
  id: "zai",
  chat: (req) => run(req),
  async stream(req, _creds, onText) {
    // The SDK has no streaming API; emit the whole reply as one delta.
    const res = await run(req);
    if (res.content) onText(res.content);
    return res;
  },
};
