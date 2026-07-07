# Security Policy

## Reporting a vulnerability

**Please do not report undisclosed security vulnerabilities in public GitHub issues.**
A public issue can disclose a weakness before it is triaged and fixed.

Instead, report privately through **GitHub Private Vulnerability Reporting**:

- Open the repository's **Security** tab → **Report a vulnerability**, or
- Go directly to
  [github.com/Kiyahj81/TextLab_Bible/security/advisories/new](https://github.com/Kiyahj81/TextLab_Bible/security/advisories/new).

Include what you observed, the impact, and steps to reproduce. As a single-maintainer,
invite-only project, responses are best-effort — you will get an acknowledgement when the
report is triaged.

## Scope

This is a personal, invite-only application (sign-in is gated by a fail-closed allowlist).
Accepted advisories, security exceptions, and outstanding hardening debt are tracked in
[`docs/security-register.md`](docs/security-register.md). Findings **already public** in the
codebase or that register (e.g. maintainer/code-review hardening items) may be tracked as
normal issues carrying the `security` label; genuinely undisclosed vulnerabilities must go
through the private channel above.
