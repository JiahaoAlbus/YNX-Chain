# IDE continuation checkpoint — source candidate, product incomplete

## Native contract tools successor to d6a9fd9e4

The complete editor's trusted Tools page now exposes the existing Devnet
contract inspector and read-only pure/view calls. Product routes are
`GET /runtime/native-tools/chain/contracts/{address}` and
`POST /runtime/native-tools/chain/contracts/call`; the latter consumes a fresh
one-use review after current native-session verification. They forward through
the existing owner-bound chain service to exactly `GET /contracts/{address}`
and `POST /ide/call` with only `{address,function}`. No execute/deploy/signature
route or shared authority is added. Named getters and bounded ABI calldata are
supported; argument functions require calldata. The response must bind the
requested address and function/selector, preserve runtime/artifact/execution
mode and limits, and contain no transaction or storage-write evidence.

HTTP-response deadlines now cover the whole streamed chain body, retaining the
original eight-second and two-MiB limits. Actual loopback upstream sends headers
and then stops its body: original source never settles before the QA's nine-
second cancellation; successor returns typed 503 at the service deadline.
Original failure `/tmp/ynx-ide-contract-body-deadline-original-20261002.log`
is preserved. Oversized streaming metadata is rejected before buffering it all.

Engineering validation: full codeoss/chain/identity-activity suite 85/85, zero
skip; subsequent selector-mismatch and metadata-size case 1/1.
Actual React+Chromium inspector/call/address-change path passes with controlled
browser routes, including exclusion of nonpayable functions and preservation of
source-analyzer limitations. First browser attempt timed out on an overly exact
accessible-label locator; its incomplete receipt wrongly contained passed=true
because it only counted console errors. That receipt is preserved as
`/tmp/ynx-ide-contract-browser-first-incomplete-20261002.json` and is not
acceptance evidence. The test now marks passed only after all assertions, uses
the actual combobox accessible name, and writes the final receipt. Existing
Tools 401 retirement and 320/390/1280px layout checks pass. Frontend typecheck and
production build pass with retained dependencies and local build cache.

Read-only public `/status` and `/ide/compiler` observations confirm chain6423
and public Testnet, but the compiler explicitly reports source-analyzer output,
productionCompilerEnabled=false and local-verifier limitations. They do not
prove a real contract call, project ownership, signing, deployment or full IDE
acceptance. No actual existing QA contract address was supplied, and no contract
was created to manufacture this receipt. Current consumed API is the Devnet
`{address,function}` contract; BFT's distinct calldata/ide-contract route must
not be relabeled compatible without A's real runtime/adapter verification.

Reproduce the browser inspector with the native-tools fixture and existing
Playwright installation described below, running
`frontend/test/native-contract.browser.mjs`; optional receipt output is
`YNX_QA_CONTRACT_RECEIPT`. Durable successor evidence:
`../evidence/integration/ide-contract-tools-20261002.json`.
The full goal and all remaining release/real-workbench gates below remain open.

This visible product thread inherits `78eca0eda9bca8d16076c48b89c54c07e8ef15d1`
on `codex/ide-quota-command-diagnostics-20261002` in the existing
`ide-quota-command-diagnostics/YNX Chain` worktree. The inherited checkout was
clean. The complete production goal remains active; this checkpoint is not an
IDE release, installed acceptance, or completion claim.

## Product source changes

- Native project requests are scoped to a lifecycle epoch. Logout, project
  changes including A → B → A, and unmount retire pending catalog, import,
  launch, Stop and activity callbacks. A retired launch cannot issue a POST
  after its delayed activity check. Failed activity admission cannot launch.
- Logout retires account data and review state immediately. Unconfirmed stop
  or revocation retains the normal retry entry, including a partial HTTP 200.
  Successful confirmation restores the normal sign-in entry. Files, writer
  leases and backend recovery records are unchanged.
- Tools reverify the owner/project/runtime/account/generation after reading a
  POST body, before consuming a review or dispatching selected context. An
  identity change or expired admission rejects the request before the model.
- Tools UI retires the old identity, proposal, result and readiness on 401,
  returns to sign-in, and does not retry the model request. Unsent input remains
  in component state; this is not durable draft storage across navigation.
- Narrow/coarse-pointer IDE controls and Tools actions have minimum 44px
  targets. Long account/project strings wrap; existing YNX logo stays contained.

No shared Wallet/Auth/SSO/SDK, global routing, other product, Host or deployment
source was changed. No dependency was installed. The inherited rejected
network/package-egress/LXD work remains stopped; this checkpoint adds no
replacement executor, proxy, network policy, quota installation or privilege.

## Validation and preserved counterexamples

The persistent evidence is `../evidence/integration/ide-lifecycle-20261002.json`.
Original failures remain failures in their original logs:

- Actual loopback Node HTTP, body held after initial admission: old Tools sends
  selected context once after either account generation change or revocation,
  then rejects the result. The expiry case already rejected. Final Tools tests
  pass all 12, including both formerly failing cases with zero model dispatch.
- Actual Chromium + actual React panel, controlled browser response routes:
  original 78eca restores a late private project after logout; original 78eca
  issues a retired launch after A → B → A. The final script verifies these
  cases, old catalog retirement, 503 and partial-200 logout recovery, and
  rejected activity admission. These are UI engineering fixtures, not actual
  Wallet approval, actual container execution or public user acceptance.
- Actual React Tools in Chromium: original 78eca keeps the private plan after
  identity 401; final UI removes it and returns to sign-in without a model retry.
- Service + identity activity suite: 72 pass, zero fail/skip. First full run had
  66 pass and one test-file failure because `YNX_QA_CENTRAL_SOURCE` was absent;
  that log is preserved. Final run supplies the preexisting exact reviewed
  `/tmp/ynx-ide5289-central-d542-vmyBuO` archive. Central was not modified.
- Frontend typecheck and `npm run code:build` succeed in the isolated source
  extraction `/tmp/ynx-ide-lifecycle-20261002.dEfqGA`, using retained dependencies
  from the prior clean 230359 extraction. Final reproduction uses package
  symlinks with a separate local `.cache`; the earlier whole-node_modules
  symlink allowed the inherited TypeScript build cache to use the old QA cache.
  No dependency source was installed or rebuilt. Production
  build retains the existing large-chunk warning. Neither the worktree nor the
  shared dependency source was installed into or rebuilt.
- Chromium fixture layout at 320, 390 and 1280px has no horizontal document
  overflow with long account/project text. Logo loads and uses object-fit
  contain; mobile buttons measure at least 44px. This is not Android hardware
  acceptance or the complete installed workbench layout.

The first panel baseline probe timed out waiting for the new retry label which
the old version did not render. Its log is retained. The second baseline uses
the observable private-project assertion and fails at the intended defect.

## Reproduction

From the worktree root, with an existing Node runtime:

```sh
YNX_QA_CENTRAL_SOURCE=/absolute/reviewed/central/archive node --test apps/developer/services/codeoss-service/test/*.test.mjs apps/developer/frontend/test/identity-activity.test.mjs
```

In an isolated source extraction with retained compatible dependencies, start
the existing frontend Vite loopback server. Its `test/fixtures/*.html` entries
load the real source components and are not production build entries. Use an
existing Playwright installation, without adding or downloading dependencies:

```sh
YNX_QA_PLAYWRIGHT_MODULE=/absolute/existing/playwright/index.mjs YNX_QA_PANEL_URL=http://127.0.0.1:41947/test/fixtures/native-panel.html node apps/developer/frontend/test/native-panel.browser.mjs
YNX_QA_PLAYWRIGHT_MODULE=/absolute/existing/playwright/index.mjs YNX_QA_TOOLS_URL='http://127.0.0.1:41947/test/fixtures/native-tools.html?sessionId=12345678-1234-1234-1234-123456789012' node apps/developer/frontend/test/native-tools.browser.mjs
```

Both scripts accept optional output receipt paths. Panel scenario selection is
`YNX_QA_PANEL_SCENARIO=catalog|logout|launch|denied`; absent selection runs all.
All requests are intercepted in independent QA browser contexts; no user
browser, real credentials, live Wallet or transaction is used.

## Exact remaining integration and acceptance

A alone owns integration, shared identity changes and all Host/release actions.
This product thread has not messaged A; the checkpoint is available for the
coordinator to read. Integrate only this commit's explicit `apps/developer`
delta into A's compatible candidate; do not replace a whole working tree or
vendor shared packages. Core bootstrap/proxy/derived manifest bytes are unchanged
from the previously reviewed 78eca core.

The existing complete OpenVSCode artifact remains Linux x64. Earlier verified
manifest/tree bytes do not remove the actual local Darwin arm64 exec-format and
native-PTY failures recorded in
`/tmp/ynx-ide78eca-full-workbench-independent-readonly-20261002.json`.
An already-authorized, isolated Linux x64 executor for that exact artifact and
reviewed proxy has not been supplied to this thread. Host inventory merely
lists an existing ubuntu Node service and lxc binary; neither is proof of an
authorized runnable workbench. No attempt to enable the rejected dependencies
is part of this continuation.

Once A supplies the approved execution and final entry, continue through normal
sign-in, explicit project ownership/import, real editor/Chinese IME, save-close-
reopen, terminal and Node run, extension/language host, exact Stop recovery,
testnet reads and Wallet approve/reject, existing-model explicit context review,
refresh, cold/warm restore, logout and account B rejection. Require actual file,
terminal, process and resource isolation plus measured multi-user capacity;
mock drivers, configured limits, a single workspace or fixture screenshots
cannot pass these gates. The product remains source candidate only until that
engineering and final installed/public user journey is verified.

Public release/install/real user/real Relay/capacity: NOT_VERIFIED.
MONSTER: NOT_RUN; no confirmed actual entry and no substitute agent created.
Full IDE production goal: NOT_COMPLETED, active.
