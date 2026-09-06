> Superseded on 2026-09-06: 59508494 fixes a reproduced legacy browser recovery data-loss issue. Use [the 59508494 release record](DEVELOPER_RELEASE_59508494_20260906.md) and macos-current-59508494.json. The 5ad bytes below remain historical candidates and must not be published as final.

# Developer macOS native recovery candidate — 2026-09-06

The current ARM64 DMG fixes native Edit operations that previously changed WebKit's DOM selection without changing Monaco's model. It also prevents slow or permission-blocked workspace recovery from freezing startup, binds native OS bridges and delayed replies to the owning local page, and rejects malformed messages before native effects.

- Source: `5ad710395a76270dd09ea5fd07d25c6a7097ced3`
- Source tree: `4227b9bccea7baf58dbe729a1007a7b07ff34050`
- Branch: `codex/20260906-developer-usability`; normal push and remote readback passed.
- File: `ynx-developer-testnet-preview-macos-arm64-unsigned.dmg`
- Bytes: `295501837`
- SHA-256: `c619f1e5a48e2dc024d9cdaf3280780745a71cdf98072ec8e5f3f29a55f64eda`
- Signature: ad-hoc, no Team ID; production signing and notarization remain false.
- Native deployment target and plist: macOS `13.5`, ARM64. Node also requires `13.5`; all 13 bundled Mach-O images / 14 slices pass the inventory gate. Direct macOS 13.5 runtime acceptance remains pending.
- CycloneDX SBOM: 269 components; SHA-256 `1a322421c51479c21fcde4369eee85a7744026215815ac069aace19244d32205`.
- Compatibility report SHA-256: `358563253dab9ffacd3ed698137e878d09baa6aaaf16766d14e010e5bb59d8d3`.

The package passed its clean-source tsc/Vite/clang build, 30 focused native/recovery/routing tests, two package contract checks, independent DMG checksum verification, strict deep ad-hoc signature verification and exact replay of the embedded compatibility inventory. Compiled native fixtures reject 72 foreign frame/origin/view/name combinations before payload access and 138 malformed messages before Keychain, task or disk routing. A deliberately blocked snapshot reader leaves the main queue responsive and cannot overwrite the saved project.

The previous `048093e4` QA app restored a copied Application Support profile and passed visible Select All replacement, Undo and Redo. Its original Desktop profile startup was blocked on file access, which motivated the asynchronous recovery change. That earlier evidence does not prove installation or visible behavior of this final `5ad71039` candidate.

The release owner must install this exact candidate, verify the original profile path and saved project identity, exercise clipboard/multicursor/split/diff/read-only/input behavior, and verify save → native quit → new-port restart recovery. Native Wallet approval/signing remains separately unverified. The prior e750 and 048 candidates and profiles are preserved for comparison and recovery.

After installed acceptance, publish these exact bytes with provenance, SBOM, compatibility inventory and SHA256SUMS to immutable official storage. The planned URL is `https://developer.ynxweb4.com/downloads/ynx-developer-0.2.0-testnet-preview-5ad710395a76-macos-arm64-unsigned.dmg`; it is not live evidence. Update the official `/developer` download entry, verify full external HTTPS byte/hash readback, and complete website download → install → use → save/restart recovery. Keep an explicit rollback pointer and do not restore historical ZIPs as installers.

The machine-readable current record is `apps/developer/evidence/desktop/macos-current-5ad71039.json`. No public Web runtime, environment, Caddy configuration, Wallet SDK, system permission or installed QA profile was changed by this candidate build. Its `runtimeCheckpoint` remains a historical Web reference, not the current public source identity.
