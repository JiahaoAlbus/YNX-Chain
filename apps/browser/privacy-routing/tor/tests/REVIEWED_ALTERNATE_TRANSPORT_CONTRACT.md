# Fixed reviewed alternate entry transport QA

Native platform/provider sources, production admission, and installed25/27 inputs
are unchanged. The new Python contract accepts only the existing public config
SHA256 `2f7cf039...75407`, not an arbitrary bridge, hostname, query or URL.

The reviewed `meek_lite` default line has no RSA identity. Locked Arti2.7.0 /
tor-guardmgr0.47 requires an RSA identity before it can build a bridge. No dummy
identity or another bridge's fingerprint is added. Actual no-listener/deferred
configuration attempts and their first errors are retained externally; the
corrected short `-o` call was rejected, but its top-level error did not expose the
expected inner RSA message. Source proof and observed error are kept separate.

Official Arti supports managed Snowflake; official Tor supports Lyrebird's
Snowflake transport. The selected fixed Lyrebird0.9.0 binary metadata replaces
nominal Snowflake2.14.1 with exact
`v2.11.1-0.20260305220527-3e42aebe21a5`. That exact source was obtained via normal
official Go module/checksum infrastructure, not substituted by a newer version.
The two reviewed lines have proper RSA identities and identical fingerprint
parameters. Each encodes to387 bytes under the fixed Arti PT settings encoder,
within its510-byte SOCKS5 limit.

Source protocol basis:

- [Arti managed transports](https://arti.torproject.org/censorship/pluggable-transports/)
- [Tor Expert Bundle / Lyrebird](https://support.torproject.org/little-t-tor/circumvention/using-bridges/)

Standalone offline DATA controls (the reviewed resource path is explicit):

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_reviewed_transport_contract.py REVIEWED_PUBLIC_CONFIG FRESH_OUTPUT
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_reviewed_snowflake_contract.py REVIEWED_PUBLIC_CONFIG OTHER_FRESH_OUTPUT
```

These do not launch a transport, resolve DNS, construct Root authority, or open a
socket. The source pins and receipt scope remain separate from any runtime test.

The parent separately authorized exactly one public-backend-only Snowflake
experiment, using the first reviewed line unchanged. Its scope explicitly covers
the fixed fronts' HTTPS443 and DNS, configured STUN/UDP3478 plus RFC5780 reflected
addresses, and TLS-broker-SDP-negotiated dynamic ICE/WebRTC peers. This is entry
transport WebRTC, distinct from a WebKit page leak, and is not a static production
NE allowlist. No WebKit, personal URL, account, old profile or DDG query is used.

`SnowflakeReviewedQA.swift` directly owns the original Process, reuses the actual
official-ready parser and bounded safe trace, and creates a fresh0700 profile.
It does not call the production obfs4-only adapter startup, modify that validator,
or change the Browser path fence. Only the selected reviewed line/hash is accepted.
The base config on disk contains no broker/front/ICE/bridge identity. Transient
short `-o` arguments inject that exact line and the fixed managed Snowflake
transport. PLAN/runtime bind base-file SHA, override-JSON SHA, and merged semantic
config SHA independently. No raw network argument or PT identity is persisted.

The runtime attempt is NOT a CI test and must not be replayed automatically:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/prepare_reviewed_snowflake_qa.py FRESH_OUTPUT --qa-core-products SAME_SDK_REVIEWED_CORE --resources REVIEWED_TOR_RESOURCES
# Parent/Root must explicitly authorize the one-time entry categories and scope.json.
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/run_reviewed_snowflake_qa.py FRESH_OUTPUT
```

PT initialization must be observed by30s; official bootstrap deadline600s, same-route
fixed IANA HTTPS only after ready and at most30s, original-handle cleanup at most25s,
global observation including cleanup650s. A stop requested at625s reserves cleanup.
OneGiB sampled owned-tree RSS and256MiB new-physical budgets are enforced. Internal
official Snowflake rendezvous/ICE attempts are not misrepresented as seven sockets
or a single broker POST. Unknown cleanup retains the owner/receipt, never replaces
the backend or kills a root merely to report success. Managed PT absence is not
direct-child waitpid proof.

Success would establish only the tested public backend path. Failure is retained
without changing bridges/fronts/exits or bypassing verification. Neither outcome
creates a production qualification, LeakSafe result or ReleaseApproved state.
