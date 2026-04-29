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

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Provider Direction

The architecture is provider-neutral. Development starts in deterministic `demo` mode, and the live chat layer can later target OpenAI/ChatGPT or Anthropic while emitting the same `EngramEvent` stream.

## Credit

Brain mesh by veryfAtfr0G on Sketchfab, CC Attribution.
