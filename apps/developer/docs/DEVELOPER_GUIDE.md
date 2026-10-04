# YNX Developer developer guide

The Web surface is static HTML/CSS/modules plus framework-independent client
state machines. Run `npm test`, `npm run check` and `npm run build` in
`apps/developer`; run `npm test` in `packages/developer-client`.

Local servers expose only same-origin `/chain`, `/compiler`, `/ai-build`,
`/ai-gateway` and `/app-gateway` prefixes. Desktop packages default these
prefixes to the public Developer service, so chain status, the pinned compiler,
and AI Build keep working after a second cold launch without requiring local
YNX daemons. AI generation is a bounded POST-body SSE request. Browser headers
are not forwarded wholesale; only the three explicit AI broker headers can
cross the desktop proxy.

The compiler service requires the reviewed `solc` 0.8.24 package and the exact
`soljson.js` SHA-256 recorded in `THIRD_PARTY_NOTICES.md`. Both the readiness
endpoint and worker verify that local input; a missing or mismatched compiler
returns HTTP 503 without claiming a pinned version or generating an artifact.
There is no download or fallback to another compiler. The service can also
consume an absolute `YNX_IDE_SOLC_INPUT` directory containing the
unchanged, reviewed offline package. All 21 package files must match the fixed
package manifest digest; the existing installed dependency is not replaced.
This operator setting supplies a compiler input, not identity or workspace access.
For a self-contained distribution, `scripts/package-solidity-runtime.mjs` composes
the original compiler and its eight measured local packages into a new owned
candidate without downloads or lifecycle execution. Select its
`node_modules/solc` path as `YNX_IDE_SOLC_INPUT`; the whole dependency closure is
hash-checked before compiler loading. The existing workspace override keeps
`tmp` at 0.2.7 and is recorded explicitly. `YNX_DEVELOPER_SOLIDITY_INPUT` gives
the macOS package producer this exact complete input. The desktop measures the
bundled closure before touching user state, then uses that packaged compiler.
Canonical project authorization and execution permissions remain separate.
When admitted, compilation runs in worker threads with four active workers and
a queue of 64. These source
checks do not establish public deployment or YNX execution compatibility.
The admitted workbench Tools page separately compiles explicitly pasted source
through `POST /runtime/native-tools/chain/compile`. It requires canonical project
admission and a one-use CSRF ticket, then rechecks identity before returning the
artifact. This path accepts a single source up to 64 KiB or a reviewed editor
project snapshot of up to 32 Solidity files (64 KiB each, 256 KiB total), with
an exact contract name in the selected entry file. In the native editor, use
`YNX: Compile Solidity Project`, approve copying the current buffers (including
unsaved text), paste the JSON on the fixed YNX Tools page and explicitly review
its file list before compiling. Session locator, document versions and SHA-256
source digests bind the snapshot; changes during approval refuse the copy.
Relative imports resolve only within the submitted snapshot. There is no disk
or network import fallback, and another contract is never substituted. Its local
worker limit is four builds globally and one per owner, with no queue, a 15-second
deadline, a 512 MiB V8 old-generation heap limit and a 2 MiB response limit.
Quota is held until worker termination. The page displays diagnostics, ABI and
bytecode and downloads the source-bound artifact; changing source clears the
previous artifact. Retiring a session preserves only unsent source input or snapshot text, not
its review approval or results. A retained snapshot requires a fresh review. The path does not authorize deployment or grant an execution domain.
The hosted open model uses a separate queue of
two active requests and 32 waiting requests. Desktop test/check/package work has
its own two-active/16-waiting queue and a per-user hashed workspace. Package
installation uses the bundled npm CLI with `--ignore-scripts`, exact package
spec validation and no global install. New commands, RPC methods, sidecar
methods, provider permissions or Wallet scopes require tests and a fail-closed
default.

Monaco 0.55.1 is bundled under `/monaco`; no runtime CDN is required. Its worker
and font assets are covered by the desktop and Web CSP. The desktop compile
registry resolves only named executables already installed for the current user,
passes argument arrays with `shell:false`, denies network on macOS, bounds output
and runtime, and writes only inside the per-user project workspace. The public
Web surface does not run these local adapters. Declarative language packs can add
editing support but cannot add an executable command; expanding that boundary
requires a reviewed adapter and tests for both a successful and a failing exit.
The built-in catalog is intentionally broader than the bundled executables. Like
VS Code, the product discovers user-installed compilers and supports additional
languages through separate declarative editing packs and shell-free compiler
adapter manifests; catalog presence alone is not a readiness claim.

Do not add a direct deployment key or connect the UI to an unsigned local deploy
endpoint. Do not upgrade local source evidence to remote verification. Keep
compiler version `0.8.24`, optimizer enabled and 200 runs unless the canonical
toolchain and product contract change together.
