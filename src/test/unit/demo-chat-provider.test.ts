import { describe, expect, it } from "vitest";
import { DemoChatProvider } from "@/lib/chat/providers/demo";
import type { ChatTurnInput } from "@/lib/chat/providers/types";

describe("DemoChatProvider", () => {
  it("answers from the exact retrieved memory evidence", async () => {
    const output = await runDemo({
      message: "What city do I live in now?",
      history: [],
      retrievedMemories: [memory("current-city", "User lives in Oakland now.")]
    });

    expect(output).toBe("Based on the retrieved memory: User lives in Oakland now.");
  });

  it("does not imply evidence exists when no memory was retrieved", async () => {
    const output = await runDemo({
      message: "What city do I live in now?",
      history: [],
      retrievedMemories: [],
      turnIntent: "memory_question"
    });

    expect(output).toContain("do not have a matching prior memory");
    expect(output).toContain("offline demo");
  });

  it("acknowledges a store-only turn instead of claiming recall failed", async () => {
    const saved = memory("color", "User loves indigo.");
    const output = await runDemo({
      message: "I love the color indigo.",
      history: [],
      retrievedMemories: [],
      storedMemories: [saved],
      turnIntent: "durable_statement"
    });

    expect(output).toBe("Saved as a new memory: User loves indigo.");
    expect(output).not.toContain("matching prior memory");
  });

  it("uses neutral language for non-memory turns", async () => {
    const output = await runDemo({
      message: "Hello",
      history: [],
      retrievedMemories: [],
      turnIntent: "general_chat"
    });

    expect(output).toContain("No durable memory was stored or used");
  });

  it("lists multiple retrieved memories without synthesizing unsupported claims", async () => {
    const output = await runDemo({
      message: "What do you remember about me?",
      history: [],
      retrievedMemories: [
        memory("color", "User loves indigo."),
        memory("city", "User lives in Oakland now.")
      ]
    });

    expect(output).toContain("Based on 2 retrieved memories:");
    expect(output).toContain("- User loves indigo.");
    expect(output).toContain("- User lives in Oakland now.");
  });
});

async function runDemo(input: ChatTurnInput) {
  let output = "";
  for await (const chunk of new DemoChatProvider().streamTurn(input)) {
    if (chunk.kind === "text") output += chunk.delta;
  }
  return output;
}

function memory(id: string, text: string) {
  return {
    id,
    text,
    importance: 0.8,
    region: "hippocampus" as const,
    created_at: "2026-07-14T18:00:00.000Z",
    access_count: 0
  };
}
