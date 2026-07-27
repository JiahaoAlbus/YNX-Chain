# YNX Calendar decisions

## D-001 — Recurrence source of truth

Calendar owns recurrence schema version 1. It stores local recurrence identifiers in the event timezone and expands occurrences using IANA timezone data. Unsupported schema versions fail closed.

## D-002 — Invalid monthly/yearly dates

ByMonthDay values that do not exist in a month are skipped rather than rolled into the next month. Yearly February 29 occurrences are generated only in leap years. This avoids silent date drift.

## D-003 — Single-occurrence exceptions

A recurrence exception is identified by the original local start (`YYYY-MM-DDTHH:mm`) in the series timezone. It is either `cancelled` or `modified`; a modified exception must supply a valid replacement local start/end. This is local runtime capability, not yet a complete occurrence-scope HTTP API.

## D-004 — Conflict suggestions

Conflict detection and alternative suggestions remain advisory. Applying an overlapping event requires explicit user approval; Calendar never moves an event automatically.

## D-005 — Artifact/source separation

Hosted preview artifacts from `e227c4f0505537b19f4588ea26478c54518f0a4c` remain valid historical test-only evidence but do not prove the current runtime at `4ed42274a7abca2aaea0a426faa1c5548f8fd63e`. Release records must expose both commits.

## D-006 — Android toolchain

Android debug builds require JDK 17–21. The project build wrapper may discover an installed JDK 17 and Android SDK but must fail closed if a supported toolchain cannot be resolved. Java 24 is not silently accepted.

## D-007 — Ownership boundary

Repository-wide failures in consensus, Faucet, Trust, or IDE contract artifacts are recorded for Integration. Calendar does not patch those owners' modules from this worktree.
