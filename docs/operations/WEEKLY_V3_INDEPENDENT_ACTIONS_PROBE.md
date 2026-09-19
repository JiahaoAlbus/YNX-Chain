# Manual independent Testnet probe

This is a bounded diagnostic candidate, not a production repair or continuous
monitor. It does not establish global availability, tunnel causality, consensus
finality, or official securities Sandbox acceptance. It changes no chain state.

## Contract

- `.github/workflows/testnet-independent-probe.yml` has only `workflow_dispatch`,
  no inputs, no schedule, no push/PR trigger, and no reusable workflow trigger.
- One GitHub-hosted Ubuntu 24.04 runner, repository-wide concurrency group,
  cancel-in-progress false; workflow job deadline 10 minutes, probe step 5 minutes,
  monitor subprocess deadline 240 seconds. No matrix or automatic retry.
- Existing `testnet-transport-job.mjs`, monitor, interpreter and bundle sanitizer
  are reused. Two rounds, 30-second start spacing, maximum two concurrent requests:
  exactly eight planned GETs across old/new RPC `/status` and Faucet `/health`.
  If collection is interrupted, attempts may be fewer and acceptance stays false.
- Each curl has 5-second connect / 8-second total / 1 MiB response limit, normal
  TLS verification, HTTPS only, no redirects, no retry, no curlrc, no proxy, no
  arbitrary URL. DNS and local route diagnostics are separately bounded.
- No SSH, packet capture, Faucet claim/admission, JSON-RPC POST, signature,
  transaction, Mainnet, runtime repair, deployment or service configuration.
- No repository/business secrets are referenced; contents permission is read-only,
  checkout credentials are not persisted, and all three actions are SHA-pinned.
  GitHub's built-in checkout/artifact platform authentication is still used by
  those actions; their tokens are not passed to the probe child. Child environment
  is limited to PATH and two locale settings. No package installation is required.
- stdout contains only a generated allowlist receipt, never raw errors, response
  bodies/headers, environment variables or subprocess logs. The artifact includes
  only `receipt.json` and `diagnostic-bundle.json`, with retention 7 days and no
  directory glob/hidden files. Raw observations/state remain private runner-temp
  files and are not uploaded. A hard cancellation/deadline may prevent artifact
  upload; a missing artifact is missing evidence, not a healthy result.
- Receipt binds run/attempt URL, source commit, eight source/workflow hashes and
  bundle SHA-256. Bundle retains per-request timing/phase/failures and its input
  hash. No client address, proxy URL, runner name or local path is published.
- Each invocation starts fresh; it cannot clear any existing on-host warning or
  evaluate cross-run recovery. A green check means only this complete batch was
  healthy. Failed/incomplete batches exit 2; collection/context/export errors exit
  3. Upload runs even after probe failure. No alert delivery is configured.
- Hosted provenance plus an actual run is an independent execution location from
  this Mac. Its exact region, egress route independence and global coverage remain
  unproven; receipt and bundle explicitly keep those broader claims false.

## Manual operator launch and evidence retrieval

GitHub requires the workflow file to exist on the default branch before
`workflow_dispatch` is available, although a registered workflow may then be
run with another branch's ref. See the
[official manual-run documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
This task does not authorize merging main or changing Actions permissions.

If registered and separately authorized, issue exactly once:

```sh
gh workflow run testnet-independent-probe.yml \
  --repo JiahaoAlbus/YNX-Chain \
  --ref codex/weekly-v3-network-20260919
```

Then identify the exact `workflow_dispatch` run by source commit and branch using
`gh run list`, wait for that run, record its job/check URL and artifact URL/digest,
and download only its named diagnostic artifact. Check source commit, attempt,
source hashes, bundle SHA and sample completeness before interpreting results.
Do not repeatedly dispatch while an accepted request is queued or uncertain.
If workflow lookup/dispatch fails due to default-branch registration or access,
record no run/artifact and stop; do not use another workflow/cloud resource as a
bypass. Such failure is not a Testnet service observation.

## Offline verification and rollback

```sh
node --test scripts/verify/testnet-independent-probe.test.mjs \
  scripts/verify/testnet-transport-operations.test.mjs \
  scripts/verify/testnet-transport-monitor.test.mjs \
  scripts/verify/testnet-alias-preflight.test.mjs \
  scripts/verify/testnet-endpoint-migration-check.test.mjs
```

Fixture tests cover exact target allowlist, boundaries, redaction, absent secret
inheritance, unhealthy/incomplete/error outcomes, source binding, manual-only
workflow and exact-file upload. They make zero live target requests. Rollback is
to stop dispatching or review/revert only this package; no production rollback is
needed because no production configuration is changed. Preserve prior evidence.
