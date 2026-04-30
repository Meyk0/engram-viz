import { DemoChatProvider } from "@/lib/chat/providers/demo";
import { OpenAIChatProvider } from "@/lib/chat/providers/openai";
import type { ChatProviderClient } from "@/lib/chat/providers/types";
import type { ChatProvider } from "@/types";

export function createChatProvider(provider: ChatProvider): ChatProviderClient {
  if (provider === "openai") return new OpenAIChatProvider();
  return new DemoChatProvider();
}

export function configuredChatProvider(): ChatProvider {
  const requestedProvider = process.env.ENGRAM_CHAT_PROVIDER ?? process.env.CHAT_PROVIDER;

  if (
    requestedProvider === "openai" &&
    process.env.OPENAI_API_KEY &&
    process.env.OPENAI_LIVE_ENABLED === "true"
  ) {
    return "openai";
  }

  return "demo";
}
