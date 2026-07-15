# Package Releases

Engram publishes five packages from one synchronized version:

1. `@engramviz/core`
2. `@engramviz/sdk`
3. `@engramviz/adapter-mem0`
4. `@engramviz/studio`
5. `@engramviz/cli`

## Before the first release

1. Reserve or create the `@engramviz` npm scope.
2. Configure npm trusted publishing for `.github/workflows/release.yml`, or add an automation token as the `NPM_TOKEN` repository secret.
3. Confirm the package version and changelog.
4. Run `npm run test:distribution` on the release commit.
5. Push a matching tag such as `v0.1.0`.

The workflow rejects a tag that does not match every package version. It runs deterministic tests and the clean-room packed-package test, builds the platform-neutral standalone Studio on the GitHub Linux runner, and publishes packages in dependency order with npm provenance.

## Versioning

All packages use one version so a CLI release always targets a compatible Studio, SDK, and contract. Breaking telemetry, turn-envelope, or regression-artifact changes require a major version. Additive APIs and optional contract fields may ship in a minor version; fixes ship in a patch version.

Do not publish generated `packages/*/dist` directories from a developer machine. The release workflow builds them from the tagged source and tests the exact tarball structure first.
