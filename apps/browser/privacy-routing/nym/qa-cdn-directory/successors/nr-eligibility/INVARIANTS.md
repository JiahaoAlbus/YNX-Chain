# Complete directory data and eligible QA candidates

This successor changes one compile-time QA CLI leaf. It neither changes the normal
reviewed-network allowlist nor issues Root, Browser, NE or release permission.
The failed 49e6 run emitted only `qa-directory-requester-binding`; its two OR branches
remain unknown. Its 50 bytes, failed exit and reaped original process are preserved.

The fixed f92749 official archive was rehashed as
`a8f1d3f61247487feedbb8a4408e123ab2198091ac36829be598a2ab8e342485`.
The SDK, API description collector, DTO definitions and node-side address producer
were compared byte for byte with that archive; evidence is the WD
`nym-qa-cdn-nr-eligibility-20261108/OFFICIAL_NR_SOURCE_READBACK.json`.

| Predicate | Decision and official source |
| --- | --- |
| Full Basic and Described pages, declared totals, typed decode, byte limits | Unchanged. The supplied complete tables are never shortened or rewritten. |
| Epoch and Basic metadata freshness | Unchanged strict QA checks. Described has no independent epoch field; this does not claim otherwise. |
| Unique node IDs and typed identity keys | Unchanged for both tables. A reverse identity-to-ID index additionally rejects a known cross-ID conflict before a missing-description continuation. |
| Missing described record | Not a candidate; keep the Basic row. Official `socks5_discovery.rs:135-145` documents the scraped described set as a subset and skips missing joins. |
| Basic IPs and an existing join | Every Basic row still needs nonempty IPs, including an unjoined row. Existing joins still require exact identity and IP-set equality. These are intentionally strict QA constraints, not a claim that every upstream consumer enforces them. |
| Actual Entry role and supported Entry capability | Unchanged optional-WSS successor: known invalid/conflicting fields reject; missing optional fields do not produce a usable TLS endpoint. At least one matching canonical-host, nonzero-WSS Entry is required. Non-Entry rows do not acquire Entry capability. |
| Missing NR or malformed Recipient string | Not a candidate; retain the original row and string. Official `socks5_discovery.rs:147-167` skips missing or unparsable requester candidates. This does not endorse malformed strings or send traffic to them. |
| `uses_exit_policy == false` | Legitimate directory capability state, not a typed-data failure. `type_translation.rs:155-160` distinguishes the exit policy from deprecated allowlists; `query_helpers.rs:32-37` computes this flag from enablement and the approved source. Such a row is not eligible for this QA. |
| Recipient gateway versus hosting node identity | General Recipient parsing/routing does not make these identical. The official embedded NymNode constructor does use its own identity (`node_details.rs:616-622`), while independent NR clients can choose or switch a registered gateway. This QA keeps the narrower **selected embedded NR** requirement; other rows remain present but ineligible. |
| Chosen exit | Still actual `ExitGateway`, `supported.exit_nr`, existing strict identity/IP join, valid typed Recipient, approved exit-policy flag and same-node gateway. At least one such candidate is required. Nothing falls back to an arbitrary public NR. |
| Sphinx key rotations | No invented cross-version equality is added. Official `NymNodeDescriptionV2::current_sphinx_key` handles current/preannounced/legacy rotations; the original client consumes the approved topology separately. |
| Future initialization | Complete DATA is not an init capability. A QA bridge must apply these Entry/NR predicates **before ranking**, pin one pair, retain the actual capture owner/nonce/hash/expiry, use a legal fresh bundled profile ID, and keep init's independent reviewed policy and API dependencies. |

The new component fixture uses real official DTO codecs and the prior private
validator as a counterexample. It supplies complete tables with honest independent
totals, preserves every input field, and checks that unavailable candidates never
become selected merely because their row was retained. No fixture opens a socket,
creates a profile, reads private keys, or grants production qualification.
