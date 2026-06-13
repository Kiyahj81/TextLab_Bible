# Documentation map

This project keeps three kinds of docs. Start with the living reference set; the
rest is history you consult on demand.

## Living reference (read these first)

- **[PROJECT_STATE.md](PROJECT_STATE.md)** — the single source of truth for where
  the project stands: shipped features, what's on `main`, and outstanding work.
- **[HiFi-exegesis-nt-roadmap.md](HiFi-exegesis-nt-roadmap.md)** — the Milestone 3
  roadmap and the **locked scope decisions** (what is deferred: OT Hebrew/Aramaic,
  Strong's, speaker metadata, explicit word alignment). Still-active guardrails.
- **[security-register.md](security-register.md)** — accepted security advisories,
  exceptions, and operational/tooling gotchas. Consult before changing
  security-relevant code or debugging environment/TLS issues.
- **[../README.md](../README.md)** — product + architecture overview and setup.

## Design & execution history (`superpowers/`)

One design **spec** and one implementation **plan** per shipped feature, dated by
when the work happened. Not quick-reference, but the place to learn *why* a feature
works the way it does.

- **`superpowers/specs/`** — design rationale and decisions. Notably, the two
  `2026-05-27` paradigm specs record the core architecture call: agentic
  tool-calling (Paradigm B, *rejected*) vs. deterministic hybrid retrieval
  (Paradigm C, *chosen and shipped*).
- **`superpowers/plans/`** — step-by-step execution records.
- **Live backlog:** `superpowers/{plans,specs}/2026-06-11-production-launch-followups*`
  still tracks unfinished work (OAuth email allowlist, Upstash rate limiter) —
  this pair is a TODO, not history.

## Retired (`archived/`)

Superseded planning docs kept for provenance: the original MVP spec, earlier
milestone plans, the aspirational technical-architecture blueprint, the security
remediation plan, and the closed `ui-review/` passes (all 55 findings fixed; see
PROJECT_STATE for the summary).
