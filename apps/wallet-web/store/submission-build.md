# Reviewer source and reproducible build instructions

This build supports two explicit authority modes. Ordinary development/release builds retain the historical Git checks. A reviewer source archive uses a read-only authority file exported by a normal immutable Git build. Every record is matched to the builder's fixed commit/path mapping and checked using both the original Git blob SHA-1 (including its blob header) and SHA-256. Missing, changed, duplicate, extra or noncanonical records fail. There is no automatic fallback when Git fails.

Mozilla requires readable bundled/minified source and reproducible output; source, locked dependencies and build instructions must accompany the version. [Mozilla source submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)

## Materialize an immutable reviewer archive

Run from a new checkout of the final root-approved commit, with its own dependencies or a previously verified dependency runtime. Never run in an installed extension directory, user profile or mutable download directory. The exporter rejects changed tracked source, symlinks, an uncommitted exporter, an explicit standalone authority override and an existing output directory.

```sh
# Run inside the exact immutable repository checkout.
npm ci --prefix packages/wallet-auth --no-audit --no-fund
npm ci --prefix apps/wallet-web --no-audit --no-fund
node apps/wallet-web/store/export-reviewer-source.mjs /absolute/new/output-directory
```

The exporter selects only committed Web source/assets/tests/store material and package locks, the exact Wallet/Auth SDK source and package locks, and two PWA test contract files. It copies bytes from Git objects after comparing the checkout. It does not include `.git`, `node_modules`, existing artifacts, audit evidence, credentials or profiles. Default Git authority validation remains active while producing the reference build and `build-authorities.json`. The archive contains `source-package.json`, per-file source hashes and expected output hashes, and `REBUILD.md`; its outer ZIP SHA-256 is recorded separately.

The historical inputs remain those embedded in `scripts/build.mjs`: commits `d0f89797`, `38c9c0ce`, `39c80021`, `98c6d5d7`, `0c9846e6`, `c3ab255c`, `d3831c30` and `9ab9cd8c`. These are input authorities, not the current packaged SDK source. The SDK runtime files are copied from the final release commit. No historical checks are deleted or replaced with a successful mock response.

## Rebuild the extracted archive without the repository

Extract into a new directory. Source entries are ordinary files, with no dependency links to a developer checkout. Do not copy an existing `node_modules`. From the archive root:

```sh
npm ci --prefix packages/wallet-auth --no-audit --no-fund
npm ci --prefix apps/wallet-web --no-audit --no-fund
node apps/wallet-web/store/rebuild-reviewer-source.mjs
```

The rebuild verifies source hashes and the authority file, checks that dependencies are installed within the extraction tree (including nested symlink destinations), sets the exact packaged source identity, and runs the same builder with the explicit authority input. It compares every generated file and the complete output inventory against the normal Git build. Internal npm `.bin` links may be present; links outside the extracted tree are rejected. Successful evidence is `rebuild-result.json` with `allBytesMatch: true`, bound to the source commit. No Git command is needed in this path. Preserve the result and the archive's full SHA-256; do not claim a match from a successful build exit alone.

Build environment used for this candidate: macOS/Darwin arm64, Node 24.19.0, npm 11.19.0, esbuild 0.25.10, sharp 0.33.5 and web-ext 10.6.0. Install Node from its [official distribution](https://nodejs.org/en/download). Dependencies are fetched with npm and verified against the included integrity locks; the Web lock currently contains `registry.npmmirror.com` resolved URLs and the SDK lock uses `registry.npmjs.org`. Record the actual installation transcript and tool versions. Do not imply that npm ran only against npmjs.org, or that a Linux clean rebuild was tested when only macOS was used.

This candidate's final immutable archive/extracted-rebuild receipt belongs in the release audit after the root commits the source. A dirty candidate, prior `882` archive or an archive using an older source identity is not a substitute. Normal `npm run package` remains a Git-checkout release command, because it validates a Git commit before packaging; the standalone rebuild intentionally uses the dedicated command above instead of weakening that guard.

## Icon provenance

Both browser manifests use `ynx-icon-128.png`, generated during the build from the approved `public/ynx-logo.png` with SHA-256 `38196080c2d56746fb37094abe68d1d89eabd8a2b29ab4f17bae48ac7e3effde`. The original square composition, color and alpha are retained, resized with sharp's Lanczos3 kernel to 128 × 128 and encoded with fixed PNG options. No new logo or brand redesign is introduced. Built dimensions and exact bytes across both extension targets are checked; the old full-size image is retained where already used in the UI/provider announcement. The browser package does not need invented extra icon sizes to satisfy the declared 128 px entry.

## Functional review remains separate

Install the immutable output in a new normal browser profile. For Firefox verify the built-in data-consent installation screen and excluded private-window behavior; developer temporary loading does not prove AMO signing or store consent. Create an isolated Testnet-only account and a new local password in the product. Do not use shared/user credentials. On a reviewer-controlled HTTPS DApp, use visible synthetic text to test discovery, connection, approve/reject, `personal_sign`, chain-6423 EIP-712, revocation, restart and navigation cancellation. Independently verify returned signatures. Preserve exact loaded build identity. Firefox container isolation and queued old-document delivery remain separate review boundaries.

Do not bypass fee/durability gates, fund a public account, use a faucet POST or broadcast while preparing store materials. Public transfers may be unavailable. Source/fake-RPC fixtures are distinct from live transactions. All runtime JS is packaged locally; RPC returns data, not remote code. Preserve the current linter output and explain warnings instead of suppressing them. Publisher information, an approved hosted privacy policy, current actual screenshots and store authorization are still required before submission.
