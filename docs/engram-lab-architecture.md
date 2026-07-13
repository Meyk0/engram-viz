# Engram Lab Architecture

Engram Lab turns the educational brain visualization into a memory observability
and replay workspace without claiming access to hidden model reasoning.

## Product modes

- **Learn** runs the guided memory demo and conversational teaching flow.
- **Observe** plays recorded or live agent traces. Only explicit memory events
  animate the brain; ordinary model, tool, handoff, and guardrail spans remain
  visible as execution evidence.
- **Investigate** works from immutable checkpoints. A user can branch from a
  checkpoint, quarantine or replace memories, replay the affected answer, and
  compare the resulting context and output.

The modes share one canonical trace and checkpoint model. They are different
views over the same evidence, not separate simulations.

## Evidence levels

Every user-facing claim must map to one of these levels:

1. **Observed**: captured directly from an Engram event or instrumented span.
2. **Mapped**: translated from a recognized memory tool with its source path.
3. **Replayed**: produced by rerunning a frozen turn under a documented state
   change.
4. **Estimated**: derived by a comparison or evaluator and explicitly labeled.

Engram never labels a supplied memory as the hidden cause of an answer. A replay
can show that an answer changed when memory changed, but model sampling and other
runtime factors remain possible explanations.

## Canonical objects

### Checkpoint

A checkpoint is an immutable snapshot after a conversation turn, dream action,
or imported trace step. It contains the event prefix, visible memories, active
context, retrieval evidence, and optional answer evidence.

### Branch

A branch references one checkpoint and applies explicit mutations:

- `quarantine`: omit a memory from retrieval and active context.
- `replace`: retire one memory and introduce a corrected branch-local memory.
- `restore`: cancel a previous quarantine or replacement in the same branch.

Branch mutations never modify the original checkpoint.

### Replay

A replay freezes the user message, prior history, provider configuration, and
retrieved memory set from a turn record. It runs a baseline and a branch variant,
then reports exact outputs and transparent comparison measurements. Engram does
not convert text edit distance into an "influence percentage."

## Delivery order

1. Canonical checkpoints, branches, and replay evidence.
2. Learn / Observe / Investigate workspace hierarchy.
3. Retrieval MRI from real retrieval traces.
4. Branching Memory Time Machine.
5. Live trace processor and shareable `.engram` files.
6. Memory Integrity and Dream benchmark reports.
7. Multi-agent private/shared memory topology.

