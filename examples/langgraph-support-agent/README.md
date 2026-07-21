# LangGraph support-agent example

This example models a real support failure: an old shipping city outranks a
customer's active correction, so a replacement order is sent to the wrong
place. Retrieval is deterministic; answer generation uses OpenAI when
`OPENAI_API_KEY` and `OPENAI_MODEL` are set and an offline generator otherwise.

```bash
npm install
npx @engramviz/cli init --project support-agent --framework langgraph
npx @engramviz/cli dev
```

In another terminal:

```bash
npx @engramviz/cli run --expected Oakland -- node run.mjs
```

The CLI prints a direct incident URL. The captured turn already contains the
LangGraph checkpoint because `captureLangGraphReplayCheckpoint` attaches it to
the active Engram turn. Studio and exported CI regressions use the same
`engram.executor.mjs` module.

For the real model path:

```bash
export OPENAI_API_KEY=...
export OPENAI_MODEL=...
```

For deterministic verification:

```bash
ENGRAM_EXAMPLE_OFFLINE=true node verify.mjs
```
