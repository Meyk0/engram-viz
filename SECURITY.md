# Security Policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability or exposed credential. Use the repository's [private security advisory form](https://github.com/Meyk0/engram-viz/security/advisories/new) with reproduction steps and affected versions.

## Sensitive memory data

Agent memories, prompts, retrieved records, and answers may contain personal or confidential information. Engram local mode writes capture data under `.engram/data` and credentials under `.engram/config.json`; both are git-ignored, but developers remain responsible for filesystem access, backups, retention, and deletion.

- Use synthetic data in examples and bug reports.
- Never attach raw production capture files to public issues.
- Redact provider IDs, user IDs, prompts, memories, and API responses before sharing.
- Rotate any credential that reaches logs, commits, screenshots, or exported traces.
- Treat exported `.engram-test.json` fixtures as potentially sensitive source data.

The local bearer token and project binding prevent accidental cross-project ingestion. They are not a managed multi-tenant security boundary. Engram v0.1 does not provide end-user authentication, compliance controls, or managed retention.

## Supported versions

Until a stable release line exists, security fixes target the latest version on `main` and the latest published `0.x` package release.
