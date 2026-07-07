---
name: Bug report
about: A confirmed defect — wrong behavior, a grounding/correctness gap, or a code-review finding
title: ""
labels: bug
assignees: ""
---

<!--
Add ONE priority label after opening: "priority: P1" (critical — core trust/data/privacy),
"P2" (high — a functional bug users hit / correctness), "P3" (medium — hardening),
or "P4" (low — polish).

For an UNDISCLOSED security vulnerability, do NOT use this template — report it privately
(see SECURITY.md / GitHub private vulnerability reporting). The "security" label is only for
findings already public in the codebase or docs/security-register.md.

Delete any sections that don't apply.
-->

**Source:** <!-- e.g. code review (rated High); validated against the code; confirmed. Or: user report / reproduced locally. -->

## Location
<!-- file:line references for where the problem lives -->
- `path/to/file.ts:42-53` — what's here

## What was confirmed
<!-- The precise behavior, established against the code — not a guess. What happens, and why. -->

## Nuance
<!-- Optional: mitigating factors, an acknowledged code comment, likelihood, or why it's subtle. Delete if none. -->

## Impact
<!-- Who/what is affected and how badly. Tie it to a broken promise or contract where relevant. -->

## Suggested fix
<!-- The concrete change. Name the hook/function/path and the approach; note alternatives. -->
