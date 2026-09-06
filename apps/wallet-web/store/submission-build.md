# Reviewer source and reproducible build instructions

Draft for the next root-approved immutable commit. Do not label a dirty working-tree build with `882d04712414e7cb27aa3b81ee9aa8726cfc2b87`; that is the preceding frozen artifact. Store signing/submission is not part of these commands.

## Required input package

The build uses esbuild to bundle/minify the vault, signer, journal and address helper. Submit readable source and matching lockfiles with every candidate. Mozilla requires the reviewer rebuild to match the submitted extension files. [Mozilla source submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)

Include `apps/wallet-web` source/public/extension/scripts/test/store, its `package.json` and `package-lock.json`, and the exact `packages/wallet-auth` source plus package/lockfiles that resolve the relative SDK imports. Include the original logo/icon assets. Exclude `node_modules`, mutable `dist`, old artifacts, audit output, browser profiles, credentials, signing keys and unrelated product data. Do not upload a developer's whole working directory.

**A plain `git archive` of those two paths is not currently a self-contained build input.** `scripts/build.mjs` verifies earlier contract commits with `git rev-parse` and `git show`. The release source package must also provide the necessary local Git objects/history, or a separately reviewed standalone authority-input build mechanism. Do not remove those checks or replace the historical SHA values to make a reviewer build succeed. The local full-repository build path below is available; an extracted, self-contained AMO source archive still needs to be materialized and verified after the final commit. `sourceArchiveReady` remains false until that proof exists.

Historical authority commits referenced by the current builder:

```
d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59
38c9c0ce1400ad6ba8dc5e0c1aa1d657a6c9748d
39c80021b87730a20569b61f6ccd3f80092523c4
98c6d5d784d212df8981a53b17118a511e246ad2
0c9846e6856f53e6d0ec1bc7dd7b389fefb03441
c3ab255c32bdeb9c8e056882c315f8ad43c29c7f
d3831c300560507f64a50e73117bab7b85926d9a
9ab9cd8c8deac8563acff9ffd7e277553e20383e
```

Each required path, Git blob and SHA-256 is embedded in `scripts/build.mjs`. Its relative Wallet/Auth crypto imports must also come from the chosen release tree, not whichever branch happens to be open. Attach the final commit, source archive hash, per-file extension hashes, tool versions and literal build command transcript. ZIP-container metadata can vary across zip tools; compare every extracted file, and record the official upload ZIP's own full SHA-256 separately.

## Environment and commands

Observed candidate verification environment: macOS/Darwin arm64; Node `24.19.0`; npm available as `11.19.0`; esbuild `0.25.10`; web-ext `10.6.0`; dependencies pinned in lockfiles. Use official [Node distributions](https://nodejs.org/en/download) and npm registry installs. Linux clean-install/extracted-source reproducibility has not been run in this slice. Record OS, CPU, Node/npm versions for the final reviewer package; do not claim Mozilla's default environment was tested.

Run only in a new disposable checkout with the required Git objects. Choose the final root-approved full SHA and a new directory yourself; do not use an installed extension directory or an existing profile.

```sh
# RELEASE_COMMIT: the final 40-hex commit from the approved source manifest.
# REVIEW_DIR: a new, nonexistent directory; never a user profile.
git cat-file -e "$RELEASE_COMMIT^{commit}"
git worktree add --detach "$REVIEW_DIR" "$RELEASE_COMMIT"
cd "$REVIEW_DIR"
test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT"
test -z "$(git status --porcelain --untracked-files=no)"
node --version
npm --version
npm ci --prefix packages/wallet-auth --no-audit --no-fund
npm ci --prefix apps/wallet-web --no-audit --no-fund
cd apps/wallet-web
export YNX_WALLET_WEB_SOURCE_COMMIT="$RELEASE_COMMIT"
npm run package
node node_modules/web-ext/bin/web-ext.js lint --no-config-discovery --source-dir dist/firefox --output json
```

`npm run package` runs the source tests, builds all three targets, normalizes file timestamps, creates ZIPs and invokes `verify-package.mjs`. It writes this checkout's `artifact-manifest.json`; never run it in the shared working tree where another owner has a dirty manifest. The compiler still targets Firefox 128 JavaScript syntax, which is a compatible subset for the manifest's new Firefox 140 minimum; that syntax target is not an installation-support claim.

Run the package command again in the same clean-source checkout and compare extracted files, then repeat from the extracted reviewer source archive without access to the original repository or dependency symlinks. This second environment is the source-submission gate, not a step already completed by this document. Inspect that browser manifests, workers, all static JS imports, HTML entry scripts, CSP, built identity and PWA integrity entries resolve from the output alone. Preserve nonzero lint warnings with explanations; do not disable a warning to manufacture a clean result.

## Local reviewer usage without shared credentials

1. Install in a new normal browser profile. For Firefox, verify the built-in installation data choices and the declared desktop minimum. Confirm private-window use is unavailable. Temporary developer loading is not AMO signing or proof of the store installation consent screen.
2. Open the extension's account-vault options page. Generate a new Testnet-only account and choose a new local password. Keep its recovery key offline in that isolated environment. No publisher login, shared password or existing user account is needed.
3. Open a reviewer-controlled HTTPS DApp and request discovery, connection, `personal_sign` and chain-6423 EIP-712 signatures using visibly synthetic review text. Approve/reject through the real extension UI and verify successful signatures independently. Never use an existing user's account or request access to it.
4. Verify revoke, restart and navigation cancellation, YNX-only provider selection and default `ynx` display/copy. Record the exact source/build identity loaded. Check Firefox containers separately; no isolation claim is made.
5. Public transfer capability may be unavailable. Do not bypass fee/durability gates, fund an account, call a faucet POST or broadcast a transaction as part of this preparation. Source/fake-RPC transaction fixtures are labelled separately from a live transfer.

Reviewer notes: all runtime JS is packaged locally; fixed HTTPS RPC responses are data, not downloaded code. The privacy drafts identify RPC operations before account connection and local raw-transaction history. Four current app template `innerHTML` lint warnings have source explanations in `permissions-data-map.md`. The existing declared-icon-size warning remains an actual pre-submission asset correction. No store signing credentials are included or requested.
