# Security Register

Tracks known security advisories, exceptions, and outstanding hardening
debt. Update whenever an advisory is accepted, mitigated, or closed.

Review cadence: re-run `npm audit --audit-level=low` at the start of every
sprint and at every Next.js minor upgrade. Cross-check each open row.

## Open

### GHSA-qx2v-qp2m-jg93 — postcss line return parsing

| Field | Value |
| --- | --- |
| Severity | Moderate |
| Advisory | https://github.com/advisories/GHSA-qx2v-qp2m-jg93 |
| Affected package | `postcss@8.4.31`, bundled transitively under `next` |
| Direct dependency that pulls it in | `next` |
| First fixed version | `postcss@8.4.31` is the vulnerable version; fix is in `postcss@8.4.32` and later |
| Status | Accepted exception — upstream-blocked |
| Mitigation | We do not feed untrusted PostCSS source to any build step. PostCSS only runs at build time over our own `app/globals.css` and Tailwind output. No user-controlled CSS reaches it. |
| Path to resolve | Wait for a Next.js release that bundles a newer PostCSS, then upgrade Next and re-run `npm audit`. Do **not** run `npm audit fix --force` — it proposes a breaking Next downgrade. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-05-25 (Sprint 3) |
| Next review | Re-check after each Next.js minor release. |

### Generated-study-notes request body limit raised to 128 KB

| Field | Value |
| --- | --- |
| Severity | Low (request-size / DoS-surface consideration) |
| Change | `POST /api/generated-study-notes` caps raised: `NOTE_BODY_LIMIT` 64 KB → 256 KB, `MAX_ANSWER` 10 KB → 64 KB, `MAX_MARKDOWN` 12 KB → 72 KB (`app/api/generated-study-notes/route.ts`). |
| Reason | The retrieval-scoping change returns whole passages in full, so a deterministic-fallback answer overflowed the old caps and 400'd on save. A single chapter is ~13 KB; the true worst case is a multi-reference prompt at the planner's 8-passage-call ceiling (4 large chapters × 2 corpora), measured on the full corpus at ~57 KB answer / ~58 KB markdown / ~167 KB request body. Caps sized to that ceiling with margin. |
| Status | Accepted — bounded |
| Mitigation | Endpoint is behind auth (`requireAuth`) and same-origin (`assertSameOrigin`); `readJsonLimited` still rejects bodies over the 256 KB cap with 413. The upstream answer/markdown sizes are hard-bounded by `MAX_PLANNED_CALLS` (8) × `MAX_PASSAGE_LINES`, so payloads cannot grow unboundedly — a 6-reference prompt produces the same size as a 4-reference one. |
| Owner | Maintainer (kiyahj81) |
| Opened | 2026-05-30 (retrieval-scoping branch) |

## Tooling notes

- `npm audit` requires network access to the npm registry. If the
  registry call fails with `unable to verify the first certificate`,
  that is a local TLS trust-store issue (corporate root CA, MITM
  proxy, AV HTTPS scanning, or similar), not an advisory.
- **Resolved on the maintainer's Windows machine (2026-05-26):** Norton
  AV's "Web/Mail Shield" intercepts the registry TLS and re-signs with
  a root that lives in the Windows certificate store. Node 22+ does
  not consult the Windows store by default. Fix: set the user-level
  env var `NODE_OPTIONS=--use-system-ca` (e.g. via
  `setx NODE_OPTIONS "--use-system-ca"`), then re-open the shell.
  Node will then trust the Windows store in addition to its bundled
  CAs and `npm audit` succeeds.
- Alternative if `--use-system-ca` is unavailable or undesired: export
  the intercepting root to a `.pem` file and set
  `NODE_EXTRA_CA_CERTS=<path-to-that-pem>`.
- Fallback: run audits from CI or any machine with clean registry
  access before declaring the gate met.

## Closed

_None yet._
