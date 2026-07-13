import type { ChatProviderClient, ChatTurnInput, ProviderChunk } from "@/lib/chat/providers/types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export class OpenAIChatProvider implements ChatProviderClient {
  readonly id = "openai" as const;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly apiKey = process.env.OPENAI_API_KEY,
    readonly model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL
  ) {}

  async *streamTurn(input: ChatTurnInput): AsyncIterable<ProviderChunk> {
    if (!this.apiKey) {
      yield {
        kind: "error",
        message: "OpenAI provider is selected, but OPENAI_API_KEY is not configured."
      };
      return;
    }

    const response = await this.fetcher(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        instructions:
          "You are the chat layer for Engram, a neural memory visualizer. Answer concisely and explicitly reference relevant memory traces when they are provided.",
        input: [
          ...input.history.map((message) => ({
            role: message.role,
            content: message.content
          })),
          {
            role: "user",
            content: buildTurnPrompt(input)
          }
        ],
        max_output_tokens: 420
      })
    });

    if (!response.ok) {
      yield {
        kind: "error",
        message: `OpenAI request failed with status ${response.status}.`
      };
      return;
    }

    const payload = (await response.json()) as unknown;
    const text = extractResponseText(payload);
    if (!text) {
      yield {
        kind: "error",
        message: "OpenAI response did not include text output."
      };
      return;
    }

    yield {
      kind: "text",
      delta: text
    };
    yield { kind: "done" };
  }
}

function buildTurnPrompt(input: ChatTurnInput) {
  const memoryContext =
    input.retrievedMemories.length > 0
      ? input.retrievedMemories
          .map(
            (memory) =>
              `- ${memory.text} (topic: ${memory.topic ?? "unknown"}, importance: ${memory.importance.toFixed(2)})`
          )
          .join("\n")
      : "No retrieved memory traces.";

  return `Relevant memory traces:\n${memoryContext}\n\nUser message:\n${input.message}`;
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  if ("output_text" in payload && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!("output" in payload) || !Array.isArray(payload.output)) return "";

  return payload.output
    .flatMap((item) => {
      if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) {
        return [];
      }

      return item.content.map(extractContentText);
    })
    .filter(Boolean)
    .join("");
}

function extractContentText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  if ("text" in content && typeof content.text === "string") return content.text;
  return "";
}
