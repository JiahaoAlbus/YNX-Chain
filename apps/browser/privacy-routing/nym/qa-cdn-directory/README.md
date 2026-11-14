# Explicit QA directory successor

This is a source-only overlay candidate. It has not been applied to the vendor checkout,
built with Cargo, used over a network, packaged, or admitted for a normal Browser route.
It does not modify the frozen `741215…` binary, the encoding-observation leaves, or any
normal Root/NE/Browser qualification. The previous incomplete directory cases remain failures.

The pinned official `common/network-defaults/src/mainnet.rs` supplies
`https://cdn1.media-platform.net/api/` without front hosts and the numeric peer
`172.104.178.252`. Fastly/front-host rotation is deliberately outside this candidate.
These are public directory resources, not user browsing destinations or authorization.

## Actual proposed call path

1. Apply `qa-cdn-directory.patch` to a separate copy of the exact source described by
   `source-pin.json`. Check every before/after digest and the unchanged Cargo.lock. Do not
   apply it over the frozen runtime or overwrite prior build receipts.
2. The optional Cargo feature `ynx-qa-directory` forwards from `nym-socks5-client` through
   `nym-validator-client` to `nym-http-api-client`. It is off in all three default features.
3. Only the new hidden command `ynx-qa-cdn-directory` can install this QA schema. It rejects
   the normal reviewed-policy triplet and custom environment files before command execution.
   The normal command and the original v2 origin allowlist remain unchanged.
4. `commands/qa_directory.rs::install` checks the exact owned regular plan file, uid,
   single link, mode 0600, inode/device stability, size and expected SHA256.
5. `qa_directory::install` validates the distinct purpose, run ID, source pin, exact CDN
   origin/IP and at most 120 seconds of absolute validity. It rejects mixed normal context.
6. `take_session` is once-only. The session fetches distinct Basic pages, then distinct Described pages, then Epoch.
   Each table is limited to 80 pages (indices 0 through 79); every URL is issued at most once.
   A failed or cancelled session cannot continue with another page. It has no arbitrary URL/path, front host, retry or fallback input.
   `fetch` uses the existing official Mozilla-root rustls factory and absolute-deadline helper,
   a closed numeric resolver, HTTPS only, original hostname/SNI, HTTP/1, no proxy/redirect/retry,
   connection limit 8 seconds, headers 20 seconds, positive-body-progress idle 20 seconds,
   and a 4 MiB decoded-body limit per page plus 16 MiB across all responses. Neither chunks
   nor pages/resources renew the absolute deadline.
7. The command decodes the official full typed Basic response, official V2 bincode described
   table, and epoch. Page number, total and complete Basic metadata must stay consistent.
   Only after every declared row arrives is page-local size normalized to the aggregate count.
   It rejects incomplete/ambiguous tables, identity/IP mismatch, stale epoch,
   a declared exit without an actual ExitGateway role, malformed/wrong-gateway Requester,
   unusable entry WSS metadata, or a Requester without the official exit policy. It emits the
   original `YNX_NYM_DIRECTORY_V1` DATA envelope only after all validation, at most 16 MiB.

No profile, private key, init, gateway registration, Mixnet runtime, SOCKS listener, proof,
WebKit, download or normal readiness transition is present in this command. A later init/run
still needs its own approved runtime policy and lifecycle; this QA directory cannot be used
as a normal origin permission. The official CDN listing is not a production issuer capability.

## Private plan input

Use a fresh owned 0700 directory and an exclusive 0600 regular file. Replace the run ID and
the times once, immediately before a separately approved run. Do not renew the file in place.
The expected SHA is over the exact file bytes, including formatting. Unknown fields are refused.

```json
{
  "schema": "YNX_NYM_QA_CDN_DIRECTORY_V1",
  "purpose": "fresh-complete-directory-only",
  "runID": "qa-dir-0123456789abcdef0123456789abcdef",
  "issuedAt": 1000,
  "expiresAt": 1110,
  "networkDefaultsSHA256": "596d541b58fdfe26082f858437165969a3933316482c279efbd21f5494b55a7b",
  "origin": "https://cdn1.media-platform.net",
  "addresses": ["172.104.178.252"]
}
```

The example times are expired DATA, not a usable lease or an instruction to run. The candidate
command shape for a future separately reviewed artifact is:

```text
<new-QA-runtime> --no-banner ynx-qa-cdn-directory --plan <private-plan-file> --plan-sha256 <exact-sha256> --run-id <same-run-id>
```

An eventual approved build would use the existing locked offline single-job recipe plus
`--features ynx-qa-directory`; it must receive a new binary/source receipt. This module has
not run that build. The normal default-feature artifact must separately reject the QA command.

## New validation evidence and remaining gates

The same cached SDK compiled both new actual modules. The original offline probe passed 27 new
policy/resolver/one-shot controls and 17 typed-table/role/identity/epoch/file controls. It did
not call a permitted `fetch`, create a socket, provision a profile, or mint an authority.
The first PublicKey value/reference compile error is preserved separately from its fix.
A successor pagination-only probe passed 18 transport/order/cumulative-bound and 15
aggregation/metadata/size controls; it did not rerun the original 44 checks. The fixed official
API handlers currently ignore pagination, but the successor also handles a service that
actually paginates; it never treats a first-page fixture as evidence of a complete live network.

`tests/policy_checks.rs.in` and `tests/cli_checks.rs.in` contain the exact new probe bodies.
The WD handoff supplies the coherent SDK cache graph, exact wrapper/argv, input hashes and
receipts. A clean CI runner does not have this vendor/cache producer; these results do not
claim portable CI or full three-crate feature integration. Parent resource scheduling and C
review precede a real successor build or any public request. Normal privacy remains blocked.
