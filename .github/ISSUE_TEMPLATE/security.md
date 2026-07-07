---
name: Security / privacy issue
about: A security- or privacy-sensitive finding (exposure, erasure gap, auth/authorization, secret handling)
title: ""
labels: "bug, security"
assignees: ""
---

<!--
Add ONE priority label after opening. Security issues usually rate "priority: P1" (core trust/data/privacy)
or "P2". If this is really an enhancement (hardening not yet exploitable), swap the "bug" label for
"enhancement". Also cross-check docs/security-register.md — record accepted/mitigated/closed advisories there.
-->

**Source:** <!-- e.g. code review (rated High); validated against the code; confirmed. -->

## Location
- `path/to/file.ts:42-53` — what's here

## What was confirmed
<!-- The precise behavior and the exposure/erasure/authorization gap it creates. -->

## Impact
<!-- Data exposed? Promise/erasure-contract broken? Include mitigating factors (e.g. "blobs are private"). -->

## Suggested fix
<!-- The concrete change to close the gap. -->
