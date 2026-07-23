# @engramviz/cli

The local-first CLI for [Engram](https://github.com/Meyk0/engram-viz).

Run the complete flagship incident with:

```bash
npx --yes @engramviz/cli demo stale-location
```

The demo reuses a compatible Studio on port `3100` or automatically starts on
the next available port when another local project is already running.

Initialize capture with `engram init`, inspect setup with `engram doctor`, launch
the packaged workbench with `engram dev`, inject local capture variables with
`engram run`, and execute exported memory regressions with `engram test`.

Regression output supports `--format pretty|json|github` and `--output` for a
structured CI artifact.

The setup scan detects Mem0 and LangGraph projects and recommends the matching
Engram adapter when it is missing.
