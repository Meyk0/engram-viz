# Replay Fidelity v2

Engram's v1 turn record freezes the visible conversation, selected memories, events, answer, and provider identity. That is useful evidence, but it is not a complete runtime snapshot. It cannot by itself establish that a second model call reproduces the first one.

`src/lib/evidence/replay-fidelity.ts` adds a provider-neutral, additive runtime manifest. It does not modify or replace `TurnRecord` v1.

## Manifest boundary

An `engram.replay-runtime` v2 manifest can record:

- The complete ordered model input plus separate system and developer instruction evidence.
- Model provider, deployment/model name, parameters, seed evidence, and an explicit determinism attestation.
- Tool definitions, call inputs, call outputs, ledger completeness, and whether replay executes tools or uses recorded outputs.
- Retrieval configuration, corpus version or hash, original outputs, and whether replay reruns retrieval or uses recorded outputs.
- Code version, runtime version, dependency lock hash, configuration fingerprint, and optional container identity.
- Network, filesystem, external-service, and overall side-effect isolation.
- Source trace/span identity, capture method, and provenance.

Each artifact uses one of four evidence states:

- `value`: Engram has reconstructable JSON content.
- `hash`: Engram can verify content supplied elsewhere but cannot reconstruct it.
- `absent`: the runtime explicitly attests that the field did not exist or was not applicable.
- `unavailable`: the evidence was not captured.

Hashes should be generated after canonical serialization. The current contract validates SHA-256 shape but intentionally does not prescribe a canonical JSON algorithm yet.

## Fidelity levels

`analyzeReplayFidelity` is deterministic and conservative:

| Level | Meaning |
| --- | --- |
| `exact` | Inputs and execution boundaries are reconstructable, source/runtime identities are fingerprinted, side effects are isolated or stubbed, and every rerun boundary has an explicit determinism guarantee. |
| `controlled` | The runtime can be recreated under controlled inputs, but output identity is not guaranteed. This is the normal ceiling for most hosted model APIs. |
| `partial` | A replay can be attempted, but missing configuration, corpus, tool, environment, or provenance evidence leaves uncontrolled differences. |
| `unreplayable` | Critical model identity/input is missing, or live side effects make a safe evidence-backed replay unavailable. |

The report contains every known gap in `missingEvidence`, labeled by impact:

- `blocks_replay`
- `reduces_control`
- `prevents_exactness`

The analyzer never promotes a run because it happened to return the same text. A seed is not a determinism guarantee. A prompt hash is not prompt content. Recorded retrieval does not prove the same corpus still exists. A mapped trace is not native runtime evidence.

## Replay modes

Tool and retrieval boundaries declare a replay mode instead of leaving behavior implicit:

- `not_used`: the boundary did not participate.
- `recorded_outputs`: replay injects captured outputs and does not repeat external work.
- `execute` / `rerun`: replay performs the operation again under the captured configuration.
- `unknown`: instrumentation did not establish the boundary behavior.

Recorded-output replay requires reconstructable outputs. Rerun replay requires reconstructable configuration and explicit determinism to qualify as exact. Live network, filesystem, or service effects block a safe replay classification.

## Security and retention

Runtime manifests may contain prompts, tool payloads, retrieved memories, and configuration fingerprints. Producers should redact secrets before capture, encrypt manifests at rest, apply tenant-scoped access controls, and define retention independently from normal application logs. A hash is appropriate when content must remain outside Engram, but the analyzer will correctly report that hash-only artifact as non-reconstructable.
