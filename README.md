# Engram

See your AI think.

Engram is a 3D brain visualizer that makes LLM memory visible in real time. v1 is an embedded web demo with a chat surface, a memory/event stream, and a holographic brain visualization driven by a shared event contract.

## Status

Early scaffold. Current work focuses on deterministic memory/event contracts and testable fixture streams before wiring a live LLM provider.

## Development

```bash
npm install
npm run dev
```

The app runs in deterministic demo mode by default. To use ChatGPT/OpenAI for local chat turns, set:

```bash
ENGRAM_CHAT_PROVIDER=openai
OPENAI_LIVE_ENABLED=true
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
```

Memory extraction and consolidation are separate guarded planners. To let OpenAI decide what to store and when repeated hippocampus memories should merge into temporal memory, set:

```bash
ENGRAM_MEMORY_PLANNER=openai
OPENAI_MEMORY_PLANNER_ENABLED=true
ENGRAM_CONSOLIDATION_PLANNER=openai
OPENAI_CONSOLIDATION_PLANNER_ENABLED=true
```

Retrieval is lexical by default. To use OpenAI embeddings for semantic memory retrieval, set:

```bash
ENGRAM_RETRIEVAL_PROVIDER=openai
OPENAI_RETRIEVAL_ENABLED=true
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

OpenAI calls are server-side only. Normal tests use mocked providers and do not require an API key.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run eval:memory
npm run build
```

`npm run eval:memory` runs the deterministic memory eval harness. It covers storage decisions,
retrieval relevance, and hippocampus-to-temporal consolidation without calling a live LLM.

## Provider Direction

The architecture is provider-neutral. Development starts in deterministic `demo` mode, and the live chat layer can target OpenAI/ChatGPT while emitting the same `EngramEvent` stream. Anthropic remains a future provider boundary.

## Credit

Brain mesh by veryfAtfr0G on Sketchfab, CC Attribution.
