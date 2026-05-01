import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChat } from "@/hooks/useChat";
import type { ChatMessage, StreamChunk } from "@/types";

afterEach(() => {
  window.localStorage.clear();
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

  it("surfaces streamed error chunks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        { kind: "error", message: "Provider failed." },
        { kind: "done" }
      ])
    );

    render(<ChatHarness onChunk={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Provider failed.");
    });
  });

  it("sends client-visible memories so the server can recover session state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        { kind: "text", delta: "Indigo is still in memory." },
        { kind: "done" }
      ])
    );

    render(<ChatHarness clientMemories={[makeMemory()]} onChunk={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByTestId("streaming")).toHaveTextContent("idle");
    });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((request as RequestInit).body));

    expect(body.clientMemories).toEqual([expect.objectContaining({ id: "mem-indigo", text: "User loves indigo." })]);
    expect(body.sessionId).toMatch(/^engram-/);
  });

  it("can cancel an in-flight response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(hangingResponse());

    render(<ChatHarness onChunk={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByTestId("streaming")).toHaveTextContent("streaming");
    });

    await userEvent.click(screen.getByRole("button", { name: "Cancel message" }));

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Response canceled.");
    });
  });
});

function ChatHarness({
  clientMemories = [],
  onChunk
}: {
  clientMemories?: Parameters<typeof useChat>[0]["clientMemories"];
  onChunk: (chunk: StreamChunk) => void;
}) {
  const chat = useChat({ clientMemories, onChunk });

  return (
    <div>
      <button type="button" onClick={() => void chat.sendMessage("remember my style")}>
        Send message
      </button>
      <button type="button" onClick={chat.cancel}>
        Cancel message
      </button>
      <output data-testid="streaming">{chat.isStreaming ? "streaming" : "idle"}</output>
      <output data-testid="error">{chat.error ?? ""}</output>
      <output data-testid="history">{JSON.stringify(chat.history)}</output>
    </div>
  );
}

function makeMemory() {
  return {
    id: "mem-indigo",
    text: "User loves indigo.",
    importance: 0.84,
    topic: "preference",
    region: "hippocampus" as const,
    created_at: "2026-04-30T00:00:00.000Z",
    access_count: 0
  };
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

function hangingResponse() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "text", delta: "Thinking..." })}\n\n`));
    }
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}
