// Shared types for the AI provider layer. No runtime imports here so the
// module is safe to pull into unit tests and client-free code paths.

/**
 * What the call is for. Call sites name a task, never a model: the resolver
 * maps task -> model per provider (and per tenant override), and the adapter
 * maps task -> effort.
 */
export type AiTask = "chat" | "classify" | "extract" | "content" | "plan";

export const AI_TASKS: readonly AiTask[] = ["chat", "classify", "extract", "content", "plan"];

export type ProviderId = "anthropic" | "openai" | "zai";

export const PROVIDER_IDS: readonly ProviderId[] = ["anthropic", "openai", "zai"];

export interface AiMessage {
  /** "system" | "user" | "assistant"; any other value is treated as "user". */
  role: "system" | "user" | "assistant" | (string & {});
  content: string;
}

export interface AiUsage {
  /** All input tokens, including cache reads and cache writes. */
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type AiStopReason = "end" | "max_tokens" | "refusal" | "other";

export interface AiResult extends AiUsage {
  content: string;
  provider: ProviderId;
  model: string;
  stopReason: AiStopReason;
  latencyMs: number;
}

export interface AiCallOptions {
  /** Tenant whose AI provider integration should be used. Omit for platform calls. */
  businessId?: string;
  task?: AiTask;
  maxTokens?: number;
  /**
   * Sampling temperature. Honoured by providers that accept it (OpenAI, z-ai);
   * dropped for Anthropic, whose current models reject sampling parameters.
   */
  temperature?: number;
}

/** Normalised request handed to a provider adapter. */
export interface ProviderRequest {
  model: string;
  task: AiTask;
  system?: string;
  /** Only user/assistant turns; system content is hoisted into `system`. */
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  temperature?: number;
  /** JSON schema the response must match (structured output). */
  jsonSchema?: Record<string, unknown>;
}

export interface ProviderResponse extends AiUsage {
  content: string;
  model: string;
  stopReason: AiStopReason;
}

export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  chat(req: ProviderRequest, creds: ProviderCredentials): Promise<ProviderResponse>;
  /** Streams text deltas to `onText`; resolves with the complete response. */
  stream(
    req: ProviderRequest,
    creds: ProviderCredentials,
    onText: (delta: string) => void
  ): Promise<ProviderResponse>;
}

export interface ResolvedProvider {
  provider: ProviderId;
  model: string;
  credentials: ProviderCredentials;
  /** "tenant" when the business's own integration is used, else "platform". */
  source: "tenant" | "platform";
}

/** Raised when the model declines a request (stop_reason "refusal"). */
export class AiRefusalError extends Error {
  constructor(public readonly provider: ProviderId, public readonly model: string) {
    super("The AI model declined this request.");
    this.name = "AiRefusalError";
  }
}

/** Raised when structured output does not match the requested schema. */
export class AiOutputParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = "AiOutputParseError";
  }
}
