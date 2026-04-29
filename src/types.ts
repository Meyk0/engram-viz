export type BrainRegion = "prefrontal" | "hippocampus" | "temporal";

export type EngramMemory = {
  id: string;
  text: string;
  importance: number;
  topic?: string;
  region: BrainRegion;
  created_at: string;
  last_accessed?: string;
  access_count: number;
  embedding?: number[];
  x?: number;
  y?: number;
  z?: number;
};

export type EngramEvent =
  | { type: "store"; memory: EngramMemory }
  | { type: "retrieve"; query: string; ids: string[] }
  | { type: "fire"; ids: string[]; region: BrainRegion }
  | { type: "consolidate"; removed: string[]; added: EngramMemory }
  | { type: "load"; ids: string[] }
  | { type: "decay"; ids: string[] }
  | { type: "init"; memories: EngramMemory[] };

export type ChatProvider = "demo" | "openai" | "anthropic";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type StreamChunk =
  | { kind: "text"; delta: string }
  | { kind: "event"; event: EngramEvent }
  | { kind: "done" }
  | { kind: "error"; message: string };
