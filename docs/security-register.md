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

## Tooling notes

- `npm audit` requires network access to the npm registry. On this
  machine the registry call currently fails with `unable to verify the
  first certificate`, which is a local TLS trust-store issue (corporate
  root CA, MITM proxy, or similar), not an advisory. Run audits from a
  machine with clean registry access, or set
  `NODE_EXTRA_CA_CERTS=<path-to-corporate-root>` before running
  `npm audit`.

## Closed

_None yet._
