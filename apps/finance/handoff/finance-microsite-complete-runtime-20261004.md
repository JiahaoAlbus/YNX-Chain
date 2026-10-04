# Finance matching complete engineering runtime candidate

Source commit: `506a0d75ffed58c5031758fd66eb212ebc1faf28`
Source tree: `0f2f26fee6882552875ed50ec84daf2970188702`
Branch: `codex/exchange-sso-cookie-binding-20261002`.

Archive: `/tmp/ynx-finance-microsite-506a0d75f-linux-amd64.tar.gz`
Bytes: 31241402
SHA256: `a011898e2203ab3e0c25d3a581ce1375179f7d6cc47f20c978a90abe070a835f`
Release root: `finance-weekly-v3-506a0d75ffed-linux-amd64`.
Two complete independent builds byte-identical. Existing builder preserves
tracked browser bundles and authority inputs; no shared protocol rebuilt.

Main server ELF64 little-endian x86-64: 21082260 bytes,
SHA256 `e8b4396501fea5cf8a9b4c5eac5aa037e40e06a83cfb0933c5884a457d649804`.
Includes existing admin/broker tools/worker, authority runtime, 23 web assets
(including generated source identity), nonsecret env example and full per-file
inventory `manifest.json`. Extra programs being packaged does not activate them.

Actual archive verification: every manifest payload byte count/SHA, no unknown
archive entry, source-equal web files, binary architecture/embedded source and
generated build identity PASS. Archive-only browser harness across 320/390/1440,
en/zh-CN PASS; exact source commit above, 23 packaged web assets. Browser output:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-finance-introduction-hcV4uf`.
First archive readback failed ENOBUFS with 16 MiB diagnostic buffer against the
21 MB main binary; bounded 32 MiB readback passed without rebuilding candidate.

Publication contract for existing A executor:

- Preserve actual live state/database/env/Auth/registry and all existing service
  configuration; no new credentials or activation implied. Use fresh live
  baseline and current release as rollback, not a stale historical target.
- Root GET/HEAD without query is public introduction. `/app` and `/index.html`
  remain original application via original server handler. Root query and exact
  Auth/Wallet callback/API/download routes are not intercepted. Legacy root hash
  redirects same-tab to `/app` with search+hash intact. Return introduction link.
- Introduction requests no SDK/API/SSO/provider; it does not perform permission
  or session restoration. App retains separate Standard Wallet/private service.
- Public readback must bind `/version` and generated build identity to source,
  root/index/app/intro assets to manifest bytes; recheck callback/deep links,
  default English/Chinese, guest/private gate, no blank tabs or implicit approval.
- Native wrappers must explicitly enter `/app` for original app semantics; Web
  package success does not prove native startup/install. No native claim here.
- Rollback only through A's existing recoverable release process, restoring exact
  previous source/config/state per live baseline. This owner did no Host/SSH.

Status: source/local tests/reproducible Linux build/archive browser verified.
Public deployment, installed platforms, real account approval/signatures/financial
operation and user acceptance NOT VERIFIED. Candidate tar is engineering runtime,
not a macOS/Windows/Android user installer. Official catalog links do not assert
unavailable DMG/EXE/MSIX/APK releases.
