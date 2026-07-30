# Decision Log

## 2026-07-29 — Synchronize with current main before further release work

Merged `origin/main` at `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc` into `codex/final-resource-market`. Product-owned `.ai-bridge` recovery state was retained; the shared root operator-input registry remained owned by main; Resource Market-specific operator inputs were moved to `apps/resource-market/operator-inputs.request.json`.

Rationale: the branch was 78 commits behind main and a release candidate without current shared runtime/governance/monitoring changes would not be integration-ready.

## 2026-07-29 — Preserve stricter placeholder detection with portable fallback

The merged `scripts/validate/no-placeholder-check.sh` keeps the Resource Market branch's broader fake-claim patterns and `.github`/`apps` coverage, while retaining main's `grep` fallback. Generated dependency/build directories are excluded from both scanners.

Rationale: scan source and controlled documentation, not third-party package examples; fail on scanner errors instead of silently succeeding.

## 2026-07-29 — Treat local and public states separately

`implementedLocal`/component evidence may be recorded only for directly tested local behavior. Central integration, public deployment, authoritative settlement, hosted download, production signing and store release remain false.

Rationale: PR, CI, local smoke, handoff creation, and HTTP fixtures are not equivalent to deployed authority or public availability.

## 2026-07-29 — Bind release evidence to tested source, not the later metadata commit

`apps/resource-market/product-release.json` and public metadata bind source SHA `d683c7d28ce129daad358c84680e5980cf8ad069`, the exact candidate tested by successful GitHub Actions run `30417957999`. The subsequent checkpoint/evidence commit is administrative and must not replace the tested source identity.

Rationale: avoids circular self-referential metadata and preserves a verifiable source-to-CI relationship.
