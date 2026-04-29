# Project Instructions

Build `engram-viz` from `spec.md`.

## Priorities

- v1 only unless explicitly asked otherwise.
- Build the real interactive app, not a landing page.
- Use Next.js, TypeScript, React Three Fiber, Drei, and Three.js.
- Keep the visualization technically honest.
- Preserve the cyberpunk medical visual direction.
- Prefer working software over exhaustive abstraction.

## Autonomy

- Make reasonable implementation decisions without asking.
- Ask only for product-direction, deployment, billing, API-key, or licensing decisions.
- Run available checks before reporting completion.
- Keep changes milestone-sized and commit-worthy.
- Commit frequently with clear, specific commit messages.
- Push completed commits to `origin/main` unless working on a branch or PR is explicitly more appropriate.
- Prefer fixing verification failures autonomously before reporting back.

## Testing

- Add tests throughout development, especially for memory lifecycle behavior, API routes, event parsing, rate limiting, and UI state hooks.
- Use focused tests for each milestone instead of postponing coverage until the end.
- Keep tests deterministic; avoid depending on live LLM calls unless explicitly marked as integration tests.
- Use mocked API clients and fixture event streams for normal test coverage.

## Design Reference

- Use `docs/design-reference.md` as stylistic guidance.
- The standalone HTML reference is inspiration only, not an exact mock and not source architecture.
- Preserve the spec's three honest memory regions even if the reference includes extra anatomical labels.

## Non-Goals

- No MCP implementation in v1.
- No persistence.
- No login.
- No mobile-first rewrite.

## Verification

- Run typecheck, lint, build, or targeted tests when available.
- If a command is unavailable because the project has not been scaffolded yet, state that clearly.
