# Bundled language-service discovery

The preceding installed-preview verifier covered C++ only. Inspection found verified cached TypeScript language server, Pyright and Nomic Solidity bins already inside the package. Finder's minimal PATH did not expose them, even though the package contained their modules. No additional download, package install, language service or executor was introduced.

desktop/code-server.mjs now prepends the exact bundled Node directory and packaged application node_modules/.bin after provenance validation and before importing the gateway. Project folders are not used as executable search paths. The existing dependency-link package verifier remains unchanged. A regression launches the actual launcher with a Finder-like /usr/bin:/bin:/usr/sbin:/sbin PATH and executes a bundled shebang tool through its matching interpreter. All ten provenance/launcher cases pass, including rejection before user state for invalid metadata.

Installed-source 44e6d7ca2 then passed real TypeScript completions but exposed a separate JavaScript endpoint omission: the gateway mounted only the typescript name for the shared JS/TS language server. The successor explicitly mounts javascript through the same existing runner and its project/runtime admission. No new server, fallback or permission scope is introduced. Both failures and their exact source identities are retained.

The actual cached language suites run with these verified bins: C/C++ completion/definitions/diagnostics, TypeScript completion/definitions/symbols, Python completion/diagnostics, Solidity completion/definitions/compiler diagnostics. Twelve tests yield eight passes and four explicit skips: Go (two), Rust and Java. This is a local macOS sandbox service result, not full OpenVSCode or public multi-language readiness.

scripts/verify-local-macos-package.sh now additionally invokes scripts/verify-bundled-language-services.mjs through the installed app's Node. It sends only localhost language requests with the isolated verifier cookie jar, checks real project-symbol completions in JS/TS/Python and nonempty Solidity completions, and requires network=false for every sandbox response. Cookie/credential values are never printed. Cold startup, exact provenance/SBOM/Mach-O, C++ compilation, persistence and child cleanup remain required. Package-specific receipts identify the before/fixed results; a source-level pass is not substituted for an installed package result.

Full upstream language/debug/extension-host journeys, canonical Wallet, real AI and multi-user capacity still require the A-provided approved full-kernel mount described in IDE_NATIVE_SESSION_ENTRY_20261003.md. No LXD or package-egress operation ran.

## Existing host tools: source successor

The later local inspection found an existing arm64 gopls v0.22.0 at /Users/huangjiahao/go/bin/gopls, outside the ordinary PATH. Exposing it through a controlled QA PATH revealed two real failures: the sandbox correctly denied reading the user home containing the executable. go-lsp.mjs now binds only the resolved executable read-only, not its parent directory, user Go source or module cache. Network remains denied, HOME and Go caches remain per-request workspace paths. No download, installation, toolchain copy or bundled-tool claim is made.

With that existing binary and the previously verified cached language bins, the twelve actual LSP tests report ten passes and two skips: Rust and Java LSP. The Go passes exercise completion, definition, references, rename, formatting and document symbols. Separately, existing Homebrew OpenJDK 25.0.1 compiled and ran a packaged Java class through the real workspace HTTP task route with one-time approval and network=false (one test passed). Java compilation is distinct from the unavailable JDT LS editing server.

Receipts are in evidence/integration/ide-existing-host-tools-20261003. The previously verified 452f3bbc6 DMG remains bound to its previous source; these host-tool/source results do not update that package's identity, prove Finder tool discovery, or fill full OpenVSCode/public acceptance.
