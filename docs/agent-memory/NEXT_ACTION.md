# YNX Calendar next action

1. Run `npm run test:release`, `npm run build:statectl`, the targeted Go/Race/Vet gates, `npm test`, `npm run build`, `npm run smoke` and `npm run browser:proof` against the current evidence tree.
2. Validate `apps/calendar/product-release.json`, `product-release.json`, `public-product-metadata.json`, `release/integration/calendar-contract.json`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, `.ai-bridge/full-goal-coverage.json` and every line of `.ai-bridge/execution-log.jsonl` as JSON/JSONL.
3. Review the complete diff, commit as `docs(calendar): bind recovery evidence`, push `codex/final-calendar`, and verify Local SHA equals remote SHA with Ahead/Behind `0/0`.
4. Query GitHub for PR, Actions and Release state at the final evidence SHA. Do not create a current-source release unless CI, artifacts, SBOM, provenance and install evidence exist.
5. Update this checkpoint with the final evidence commit and then hand `release/integration/calendar-contract.json` plus CAL-X-013 to `29-integration` and `30-security-platform` for encrypted retention, independent key escrow and representative restore acceptance.
