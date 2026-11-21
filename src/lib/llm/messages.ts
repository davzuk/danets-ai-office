import type { AiMessage, ProviderRequest } from "./types";

/**
 * Split caller messages into a single system prompt plus user/assistant turns
 * that every provider accepts:
 * - all system messages are joined (in order) into `system`
 * - empty turns are dropped (Anthropic rejects empty text blocks)
 * - a conversation that opens with an assistant turn (e.g. the widget
 *   greeting) gets a short user turn in front, since the first turn must be
 *   from the user
 */
export function normalizeMessages(messages: AiMessage[]): {
  system?: string;
  messages: ProviderRequest["messages"];
} {
  const systemParts: string[] = [];
  const turns: ProviderRequest["messages"] = [];

  for (const m of messages) {
    const content = typeof m.content === "string" ? m.content : String(m.content ?? "");
    if (!content.trim()) continue;
    if (m.role === "system") {
      systemParts.push(content);
    } else {
      turns.push({ role: m.role === "assistant" ? "assistant" : "user", content });
    }
  }

  if (turns.length === 0 || turns[0].role !== "user") {
    turns.unshift({ role: "user", content: "(Conversation started.)" });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: turns,
  };
}
