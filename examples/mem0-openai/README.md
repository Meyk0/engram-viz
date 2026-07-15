# Real Mem0 + OpenAI example

This opt-in integration uses the real Mem0 OSS Node client for memory extraction and retrieval, the OpenAI Responses API for the answer, and Engram's local SDK for evidence capture. It makes paid network calls and is never run by the deterministic test suite.

The implementation follows the current [Mem0 Node SDK quickstart](https://docs.mem0.ai/open-source/node-quickstart) and [OpenAI JavaScript quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request).

## Install

From the Engram repository:

```bash
npm run build:packages
npm install --prefix examples/mem0-openai
npm run engram -- init --project mem0-openai
```

Start Studio in one terminal:

```bash
npm run engram -- dev
```

Run the real example in another terminal with your own credentials and explicit model choice:

```bash
export OPENAI_API_KEY="..."
export OPENAI_MODEL="your-available-model"
npm run engram -- run -- node examples/mem0-openai/demo.mjs
```

The script stores a San Francisco memory, submits an Oakland correction, searches Mem0 for the current city, explicitly records which results reached the OpenAI prompt, and captures the generated answer. Depending on Mem0's extraction/update decision, the resulting trace may be healthy or may expose an incident worth replaying.

Local Mem0 data is written under `examples/mem0-openai/.mem0` and ignored by git. Do not use production user data in this example.
