# engram — spec.md
*Working title. engram: the neuroscience term for a memory trace stored in the brain.*

**Tagline**: See your AI think.
**What it is**: A 3D brain visualizer that makes LLM memory visible in real time. You chat with Claude. The brain lights up.

---

## 1. What This Is and Is Not

**Is**: A visualization layer. An educational artifact that makes LLM memory legible to smart non-experts. A shareable demo.

**Is not**: A memory system. A production agent infrastructure layer. A debugging tool for developers building agents. A replacement for Mem0, Letta, or any memory backend.

**Primary audience:** AI-curious people who want to understand how memory works in modern AI systems. Smart but not specialists. The journalist, the designer, the PM, the engineer-adjacent.

**Secondary audience:** AI researchers and engineers who will judge whether the underlying model is honest. They won't be the volume, but they'll determine whether the project gets respect.

The target reaction from someone at OpenAI or Anthropic: "That's actually how memory tiers work, and it looks incredible."

---

## 2. Repository Structure

Two GitHub repos. Build in this order.

### `engram-viz` — build now (v1)
- `github.com/[org]/engram-viz`
- Next.js 14 + TypeScript
- Three.js via `@react-three/fiber`
- Anthropic API for chat + tool use
- Hosted on Vercel
- MIT license, public

### `engram-mcp` — placeholder now, build v2
- `github.com/[org]/engram-mcp`
- Create repo now to reserve the name
- README placeholder: "MCP server for engram. Coming in v2."
- Connects Claude Desktop → engram-viz via WebSocket
- MIT license, public

Both repos under the same GitHub org (e.g. `engram-so`).

---

## 3. Architecture

### v1 (build now) — embedded LLM, zero setup

```
User browser
     │
     │ chat input
     ▼
engram-viz (Vercel)
     │
     │ /api/chat (Next.js route)
     ▼
Anthropic API (Sonnet 4.6 or Haiku 4.5)
  with memory tools: store, retrieve, consolidate
     │
     │ tool calls → memory events
     ▼
3D Brain renderer
```

User clicks the link, types in the chat, the brain fires. No setup. The chat is real. The memory is real. The visualization is real.

### v2 (later) — MCP mode for power users

```
Claude Desktop
     │
     │ MCP protocol (local)
     ▼
engram-mcp  ←── localhost:3001
     │
     │ WebSocket via ngrok tunnel
     ▼
engram-viz  ←── ?ws=URL&token=TOKEN switches to MCP mode
```

Same Vercel app, two data sources. Default = embedded LLM. With `?ws=URL&token=TOKEN` query param, switches to MCP mode and hides the chat input (chat happens in Claude Desktop).

---

## 4. Memory Architecture (Technically Honest)

### 4.1 Three Regions, Each Earning Its Place

| Brain Region | LLM Memory Concept | Why this mapping is honest |
|---|---|---|
| **Prefrontal Cortex** | Active context window | Working memory in humans, working memory in LLMs. Both finite. Both flush. |
| **Hippocampus** | Recall buffer / episodic store | New memories enter here in both. Recent, raw, awaiting consolidation. |
| **Temporal Cortex** | Long-term semantic memory | Consolidated facts. Stable. Both human and LLM systems distill episodes here. |

**Cut from earlier drafts (and why):**
- **Cerebellum (procedural)** — system prompts aren't really procedural memory. They're text prepended to context. Adding the cerebellum would teach a wrong concept just to fill brain mass.
- **Amygdala (importance)** — importance is a number on a memory record, not an architectural component. Modeling it as a separate region implies storage; it's modulation. We keep the *behavior* (high-importance memories glow amber within their home region) but cut the region.

The brain mesh shows all five lobes — that's anatomy. Engram only animates three. The unused regions are honest negative space, acknowledged in the disanalogies panel.

### 4.2 Where the Analogy Breaks

Surfaced in the UI two ways: a persistent panel (via "?" icon) and contextual tooltips at moments where the metaphor strains.

The five honest disanalogies:

- **No sleep consolidation** — LLM consolidation triggers on context pressure or explicit calls, not time
- **No neuroplasticity** — model weights don't change at inference, only the external memory store does
- **No emotional system** — importance is a numeric weighting, not a felt state
- **Embedding space is the truth** — brain regions are a UX metaphor over high-dimensional vector geometry
- **Memories aren't physical objects** — visualizing storage as "a place" is a teaching simplification

### 4.3 Memory Lifecycle

```
New memory
    → lands in Hippocampus
    → if retrieved repeatedly → migrates to Temporal Cortex (consolidation)
    → if loaded into active response → fires in Prefrontal Cortex
    → if importance ≥ 0.8 → glows amber within its region
    → if not retrieved across many turns → relevance score drops, dims
```

**On forgetting:** memories don't get deleted. They drop in retrieval ranking. Visually they dim and fade but remain. Matches how production memory systems actually work.

### 4.4 Memory Data Model

```typescript
type EngramMemory = {
  id: string
  text: string
  importance: number              // 0-1
  topic?: string
  region: BrainRegion             // assigned on store
  created_at: string              // ISO
  last_accessed?: string
  access_count: number
  embedding?: number[]
  x?: number; y?: number; z?: number
}

type BrainRegion =
  | 'prefrontal'    // active context
  | 'hippocampus'   // episodic / recent
  | 'temporal'      // semantic / consolidated
```

### 4.5 Event Types

```typescript
type EngramEvent =
  | { type: 'store',       memory: EngramMemory }
  | { type: 'retrieve',    query: string, ids: string[] }
  | { type: 'fire',        ids: string[], region: BrainRegion }
  | { type: 'consolidate', removed: string[], added: EngramMemory }
  | { type: 'load',        ids: string[] }
  | { type: 'decay',       ids: string[] }
  | { type: 'init',        memories: EngramMemory[] }
```

---

## 5. Backend (Next.js API Routes)

### 5.1 `/api/chat` — POST

Streams response and memory events as Server-Sent Events.

```typescript
POST /api/chat
{ sessionId, message, history }

→ SSE stream:
  - text deltas
  - memory events
  - done signal
```

### 5.2 Anthropic API Integration

Claude Sonnet 4.6 or Haiku 4.5 (configurable). System prompt instructs the model to use memory tools actively.

```typescript
const tools = [
  { name: 'store_memory',       input: { text, importance, topic } },
  { name: 'retrieve_memory',    input: { query, limit } },
  { name: 'consolidate_memories', input: { ids, consolidated_text } }
]
```

System prompt nudges: store interesting facts, retrieve before answering personal questions, consolidate when seeing repetition on a topic.

### 5.3 Memory Storage

In-memory per session (Map keyed by `sessionId`). No persistence in v1. Tab close = fresh brain.

Embeddings: OpenAI `text-embedding-3-small` or `@xenova/transformers` MiniLM in API route. Cosine similarity, top-k.

### 5.4 Cost Protection

- **Rate limit per IP**: 10 messages/hour
- **Session token cap**: 20k input tokens total
- **Daily budget cap**: hard kill switch at $20/day Anthropic spend
- **Default model**: Haiku 4.5 (cheaper, plenty for memory demo)
- **Optional Sonnet toggle**: small button, stricter rate limit
- **Abuse handling**: detect prompt injection, return canned response

Worst case for viral launch (100k visits, 5 messages each on Haiku): ~$250.

### 5.5 No Auth

Anonymous. No login, no account. API key server-side only.

---

## 6. Visualization (engram-viz)

### 6.1 Visual Direction

**Cyberpunk medical.** Non-negotiable.

Dark background (`#050510`). Brain is semi-transparent glass — see through it, see internal structure, see neurons firing inside. Neon bloom on active neurons. Holographic brain floating in space, running on electricity.

NOT generic purple-gradient AI. NOT sterile white medical scan. Reference: Tron Legacy meets a real neuroscience visualization tool.

### 6.2 Color Palette

```
Background:     #050510
Brain mesh:     #1a2744  (30% opacity glass)
Brain wireframe:#2a4080
Prefrontal:     #00d4ff  (cyan — active context)
Hippocampus:    #a855f7  (violet — new memories)
Temporal:       #3b82f6  (blue — long-term)
Importance:     #f97316  (amber — high importance, layered on region color)
Query pulse:    #ffffff
Store orb:      #fbbf24  (gold)
Decay:          #334155  (muted slate)
```

### 6.3 Typography

- Region labels: `JetBrains Mono`
- Event feed: `IBM Plex Mono`
- UI chrome: `Syne`

### 6.4 Brain Mesh

**Source:** "the brain" by veryfAtfr0G on Sketchfab
**URL:** https://skfb.ly/pAytD
**License:** CC Attribution
**Stats:** 3.1k triangles, 1.6k vertices

Material: `MeshPhysicalMaterial`, transmission 0.6, roughness 0.1. Subtle wireframe edge glow.

Three lobe zones used (prefrontal, hippocampus, temporal). Cerebellum and frontal/parietal areas remain visible as anatomy but unused. Inspect mesh with Blender if needed:
```python
import bpy
for obj in bpy.data.objects:
    print(obj.name, obj.dimensions)
```

Slow auto-rotation (Y axis, 0.001 rad/frame) when idle. Pauses on interaction, resumes after 3s.

### 6.5 Scene Composition

```
┌─────────────────────────────────────────────────────┐
│  [status]                              [? help]      │
│                                                      │
│       [first-time event caption appears here]        │
│                                                      │
│                   [3D BRAIN]                         │
│              floating, slow auto-rotate              │
│                                                      │
│  [region labels]              [event feed]           │
│   subtle, floating             bottom right          │
│                                                      │
│  ┌───────────────────────────────────────────────┐   │
│  │  Talk to the brain...                   send  │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 6.6 Neurons

- `InstancedMesh` of spheres
- Up to 2000 at full resolution
- Size scales with `access_count` (0.01–0.04)
- Base opacity scales with `importance` (0.3–1.0)
- Decay: dropped relevance trends toward `#334155`, opacity 0.15
- High-importance: amber tint layered on region color
- Bloom via `@react-three/postprocessing`

### 6.7 Spatial Layout

Random within region bounding box on store, slight per-frame jitter. UMAP layout deferred — typical session has 5-20 memories.

### 6.8 The Three Hero Animations

**1. Memory Store** (trigger: `store`)
Gold orb spawns at brain center → curved Bezier path to hippocampus → radial burst → neuron materializes with spring scale-in → hippocampus pulses violet for 600ms. High-importance: amber tint on neuron. Duration: 800ms.

**2. Query Fire** (trigger: `retrieve`)
White electric bolt descends to prefrontal cortex → retrieved neurons flash region color → axon tubes light up between fired neurons with animated flow → neurons scale to 1.4x for 400ms then settle → prefrontal glows cyan during response. Duration: 600ms flash, axons persist 2s.

**3. Consolidation** (trigger: `consolidate`) — *signature animation*
Source neurons in hippocampus drift together → merge with shockwave ring → new neuron arcs to temporal cortex → settles with ripple → old neurons dissolve with particle trails. Duration: 1200ms.

**Supporting (v1 required):**
- Decay: gradual color shift to muted slate over 5s of no retrieval
- Idle pulse: every 8s, random temporal neuron softly pulses
- Init: brain assembles from particles over 300ms

---

## 7. Explanation Layer

This is what makes Engram teach, not just dazzle. Two modes: **always-on for first-time events**, **hover for everything else**.

### 7.1 First-Time Event Captions (always-on, one-shot)

The first time each event type fires in a session, a caption appears centered above the brain. Fades in over 200ms, holds for 4s, fades out. Never shows again that session.

| Event | Caption text |
|---|---|
| First `store` | *"This is episodic memory — a raw fact, stored as it came in."* |
| First `retrieve` | *"This is retrieval — semantic search across stored memories."* |
| First `consolidate` | *"This is consolidation — the system distilling related episodes into one summary."* |
| First `decay` | *"Memories don't get deleted in LLM systems — they just drop in retrieval ranking."* |

By message 5-6, the user has been taught the four core concepts without being lectured.

### 7.2 Region Labels (hover to expand)

Default state — glanceable:
```
PREFRONTAL CORTEX
Active Context Window
[███████░░░] 7/10
```

On hover — explanation:
```
PREFRONTAL CORTEX
Active Context Window
[███████░░░] 7/10

Everything the model has loaded right now.
Finite — when full, older memories drop out.
```

Same pattern for hippocampus and temporal:
- **Hippocampus**: "Where new memories land. Recent, raw, awaiting distillation."
- **Temporal**: "Long-term semantic memory. Facts that have been consolidated from many episodes."

### 7.3 Event Feed Inline Explanations

Each event entry has a one-line explanation underneath. Lower opacity (60%), monospace.

```
00:42  HIPPOCAMPUS  Stored: "User is a designer in Brooklyn"
                    ↳ New facts land here as raw episodes

00:45  PREFRONTAL   Retrieved 4 memories for: "what do you know about me"
                    ↳ Semantic search pulled these into the active context

00:47  TEMPORAL     Consolidated 3 memories → "User builds meditation apps"
                    ↳ Repeated facts about a topic distilled into one summary
```

### 7.4 Neuron Tooltip (hover)

```
┌────────────────────────────────┐
│ "Joscha works at Connectly"    │
│ Region      Hippocampus        │
│ Importance  ████████░░  0.8    │
│ Accessed    3 times            │
│ Stored      2 mins ago         │
└────────────────────────────────┘
```

### 7.5 Contextual Disanalogy Tooltips

The first time the metaphor strains in a way the user might miss, a small tooltip appears next to the relevant element. Auto-dismisses after 5s or on click.

| Trigger | Tooltip |
|---|---|
| First `decay` | *"Real LLM systems don't delete memories like this. They just rank them lower in retrieval. [learn more]"* |
| First high-importance store (amber) | *"Importance is a numeric weight, not an emotion. The amygdala doesn't really do this in LLMs. [learn more]"* |
| User hovers an unused region (cerebellum, etc.) | *"Empty by design. LLM memory has no clean equivalent. [learn more]"* |

Each "[learn more]" link opens the disanalogies panel scrolled to the relevant section.

### 7.6 Disanalogies Panel (always available via "?" icon)

Slide-in panel from right when "?" icon is clicked. The deep-dive surface for users who want to understand exactly what's true and what's metaphor.

```
WHERE THE BRAIN ANALOGY BREAKS

LLM memory borrows useful concepts from neuroscience
but is not the same thing. Things this visualization
deliberately gets wrong:

#1  No sleep consolidation
    LLM consolidation triggers on context pressure
    or explicit calls, not time passing.

#2  No neuroplasticity
    Model weights don't change as you chat. Only
    the external memory store does.

#3  No emotional system
    "Importance" is a numeric weighting, not a
    felt state. The amygdala isn't really involved.

#4  Embedding space is the truth
    Brain regions are a UX metaphor over high-
    dimensional vector geometry. The real "where"
    of memory is geometric, not anatomical.

#5  Memories aren't physical objects
    Visualizing storage as "a place" is a teaching
    simplification. Production systems use vector
    databases — no spatial structure at all.

#6  Two regions in this brain are unused
    The cerebellum and limbic areas remain visible
    as anatomy but aren't animated. LLM memory has
    no clean equivalent. Filling them would teach
    a wrong concept.
```

This is what makes Engram credible. Without it, the project looks naive.

### 7.7 Interaction

- **Orbit**: dampened OrbitControls. Auto-rotate resumes 3s after idle.
- **Hover neuron**: raycast → tooltip + glow + 1.2x scale
- **Hover region**: label expands with explanation
- **Click region**: camera zooms briefly
- **Scroll**: zoom in/out
- **Click "?"**: open disanalogies panel
- **Click "[learn more]"**: open panel to relevant section

---

## 8. The User Journey

### First Visit
1. Land on engram.so
2. Brain assembles from particles (300ms)
3. Hint near chat: *"Tell me something about yourself..."*
4. User types → first message → first-time caption appears: *"This is episodic memory..."*
5. Brain stores memories, neurons appear in hippocampus
6. After 3-4 messages, retrieval fires → second caption: *"This is retrieval..."*
7. After 6-8 messages, consolidation fires → third caption (the wow moment)
8. User explores: hovers regions, hovers neurons, opens disanalogies panel
9. Screenshots or shares

### Return Visits
- Each session starts fresh — no persistence by design
- Return loop is depth: explore the brain, read disanalogies, watch decay
- Or: install MCP server (v2) for persistent personal use

### v2 Loop
- Power users install engram-mcp
- Their actual Claude Desktop drives the brain
- Persistent across sessions
- The "this is MY Claude" experience

---

## 9. v2 MCP Server Spec (engram-mcp)

Documented for future reference. Build after v1 ships.

### 9.1 Tools (mirror of v1 API)

```typescript
store_memory(text, importance?, topic?) → { id, region }
retrieve_memory(query, limit?) → EngramMemory[]
consolidate_memories(ids, text) → EngramMemory
forget_memory(id) → { success }
update_memory(id, text, importance?) → EngramMemory
```

### 9.2 Storage
- SQLite via `better-sqlite3`
- Embeddings: OpenAI or `@xenova/transformers`
- Cosine similarity retrieval

### 9.3 WebSocket Emitter
Emits `EngramEvent` to all connected viz clients.

### 9.4 Security
- Token rotated each session
- WebSocket rejects without valid token
- Token in URL: `?ws=URL&token=TOKEN`
- ngrok URL rotates per restart

### 9.5 Setup
```bash
npm install -g engram-mcp
engram start --open
```

```json
// claude_desktop_config.json
{ "mcpServers": { "engram": { "command": "engram", "args": ["mcp"] } } }
```

### 9.6 Mode Switching in engram-viz
With `?ws=` and `?token=`:
- Hide chat input (chat happens in Claude Desktop)
- Connect to WebSocket instead of `/api/chat`
- Status: "connected to Claude Desktop"
- Same renderer

---

## 10. File Structure

### `engram-viz` (build now)

```
engram-viz/
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   └── api/
│   │       ├── chat/route.ts      # SSE streaming chat
│   │       └── embed/route.ts     # embeddings
│   ├── components/
│   │   ├── Brain/
│   │   │   ├── Brain3D.tsx
│   │   │   ├── BrainMesh.tsx
│   │   │   ├── Neurons.tsx
│   │   │   ├── Axons.tsx
│   │   │   └── RegionLabels.tsx
│   │   └── UI/
│   │       ├── EventFeed.tsx
│   │       ├── ChatBar.tsx
│   │       ├── NeuronTooltip.tsx
│   │       ├── StatusDot.tsx
│   │       ├── FirstTimeCaption.tsx       # event teaching
│   │       ├── DisanalogyTooltip.tsx      # contextual nudges
│   │       └── DisanalogiesPanel.tsx
│   ├── hooks/
│   │   ├── useMemoryStore.ts
│   │   ├── useEventQueue.ts
│   │   ├── useChat.ts
│   │   ├── useFirstTimeEvents.ts          # tracks which captions shown
│   │   └── useWebSocket.ts                # v2 stub
│   ├── lib/
│   │   ├── animations.ts
│   │   ├── regions.ts
│   │   ├── memory/
│   │   │   ├── store.ts
│   │   │   ├── retrieve.ts
│   │   │   └── tools.ts
│   │   ├── explanations.ts                # all caption + tooltip copy
│   │   ├── rate-limit.ts
│   │   └── theme.ts
│   └── types.ts
├── public/
│   └── brain.glb
├── CLAUDE.md
├── .env.example
└── package.json
```

### `engram-mcp` (placeholder)

```
engram-mcp/
├── README.md    # "MCP server for engram. Coming in v2."
└── package.json
```

---

## 11. Performance Requirements

- 60fps with 500 neurons + bloom on M1 Air Chrome
- Initial brain load < 2s
- First chat token < 1.5s
- Bundle < 500kb gzipped (excluding Three.js)
- Animation event → first frame < 50ms

---

## 12. Non-Goals for v1

1. No MCP server — v2
2. No Claude Desktop integration — v2
3. No persistence between sessions
4. No user accounts
5. No Cerebellum or Amygdala regions — cut for honesty
6. No contradiction event
7. No context eviction animation — v2
8. No audio — v2
9. No mobile layout — desktop only
10. No memory editing in UI
11. No export / save brain state
12. No Mem0/Letta/LangChain adapters

---

## 13. README Requirements

1. Hero GIF — 15s scripted sequence (real chat, not mock)
2. One-line: *See your AI think.*
3. Live demo link — engram.so works instantly
4. Screenshot of event feed with raw memory text
5. Architecture diagram (v1 and v2)
6. Brain region reference table
7. "Where the analogy breaks" section
8. "Coming in v2" section linking to engram-mcp
9. Credit: "Brain mesh by veryfAtfr0G on Sketchfab, CC Attribution"

---

## 14. v1 Build Order

Single Claude Code session. Use this file as CLAUDE.md.

```
1.  Scaffold Next.js, install three + r3f + drei + postprocessing
2.  Load brain.glb, glass material, cyberpunk scene
3.  Define 3 region bounding boxes, debug spheres
4.  InstancedMesh neurons, place randomly in regions
5.  useMemoryStore + useEventQueue hooks
6.  Hero animation 1: store
7.  Hero animation 2: query fire
8.  Hero animation 3: consolidation
9.  EventFeed with inline explanations
10. RegionLabels with hover-expand
11. NeuronTooltip
12. ChatBar
13. /api/chat — Anthropic + memory tools + SSE
14. Memory store + retrieve in /lib/memory
15. useChat hook — consume SSE, dispatch events
16. Rate limiting + cost caps
17. FirstTimeCaption component + useFirstTimeEvents hook
18. DisanalogyTooltip (contextual)
19. DisanalogiesPanel + "?" button
20. StatusDot
21. Mobile detection — "best on desktop" message
22. Performance pass — 60fps with 200 neurons
23. Record README GIF (real session)
24. Deploy to Vercel + Anthropic key + budget caps
```

---

## 15. Design Brief (for Claude Design / Figma)

> **Project:** Engram — "See your AI think."
>
> **Canvas:** Brain takes 85% of viewport. Fixed bottom: minimal chat input, frosted glass, 60px tall. Fixed bottom-right: scrolling event feed showing raw memory text like `HIPPOCAMPUS — Stored: "Joscha works at Connectly"` with one-line explanations underneath. Floating region labels near each lobe (hippocampus, prefrontal, temporal). First-time event captions appear briefly above the brain. Top-right: small "?" icon for the disanalogies panel.
>
> **Aesthetic:** Cyberpunk medical. Dark background `#050510`. Brain is semi-transparent glass with internal glow. Neon bloom on neurons. Tron Legacy meets neuroscience tool. Not generic purple-gradient AI.
>
> **Colors:** Cyan `#00d4ff` (active context / prefrontal), Violet `#a855f7` (new memories / hippocampus), Blue `#3b82f6` (long-term / temporal), Amber `#f97316` (high-importance overlay), Gold `#fbbf24` (store event).
>
> **Type:** Monospace for labels and feed. Geometric distinctive for chrome.
>
> **Mood:** Holographic brain floating in space, running on electricity. Screenshot-worthy on first sight. Honest about being a metaphor.

---

*v1: Three regions. Embedded LLM. Teach by showing. v2: MCP for power users.*
