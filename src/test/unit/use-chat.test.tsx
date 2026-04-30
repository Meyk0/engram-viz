import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChat } from "@/hooks/useChat";
import type { ChatMessage, StreamChunk } from "@/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useChat", () => {
  it("records one user turn and the streamed assistant response", async () => {
    const onChunk = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        { kind: "text", delta: "I will " },
        { kind: "text", delta: "remember that." },
        { kind: "done" }
      ])
    );

    render(<ChatHarness onChunk={onChunk} />);

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByTestId("history")).toHaveTextContent("remember my style");
    });

    const history = JSON.parse(screen.getByTestId("history").textContent ?? "[]") as ChatMessage[];
    expect(history).toEqual([
      { role: "user", content: "remember my style" },
      { role: "assistant", content: "I will remember that." }
    ]);
    expect(onChunk).toHaveBeenCalledTimes(3);
  });

  it("does not append duplicate user turns for multi-chunk streams", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        { kind: "text", delta: "First chunk. " },
        { kind: "event", event: { type: "retrieve", query: "style", ids: [] } },
        { kind: "text", delta: "Second chunk." },
        { kind: "done" }
      ])
    );

    render(<ChatHarness onChunk={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByTestId("streaming")).toHaveTextContent("idle");
    });

    const history = JSON.parse(screen.getByTestId("history").textContent ?? "[]") as ChatMessage[];
    expect(history.filter((message) => message.role === "user")).toHaveLength(1);
    expect(history).toHaveLength(2);
  });
});

function ChatHarness({ onChunk }: { onChunk: (chunk: StreamChunk) => void }) {
  const chat = useChat({ onChunk });

  return (
    <div>
      <button type="button" onClick={() => void chat.sendMessage("remember my style")}>
        Send message
      </button>
      <output data-testid="streaming">{chat.isStreaming ? "streaming" : "idle"}</output>
      <output data-testid="history">{JSON.stringify(chat.history)}</output>
    </div>
  );
}

function streamResponse(chunks: StreamChunk[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      });
      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}
