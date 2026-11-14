# Normal Nym proof scope and public native boundary

The normal proof child now has a real signed-Provider selector and opaque child
owner. It is separate from synthetic QA and from production qualification.
Acquiring or decoding lookup DATA never grants a socket or release permission.

`BrowserRouteProtection.normalProofBinding(profileID:profileSHA256:proofRunID:)`
uses its retained genuine normal qualifier, original Root deny receipt, exact
client configuration and own full audit token. This DATA step allows the client
to be idle: the proof child must be prepared before the complete graph exists.
`rootRunID` and the public proof URL's `proofRunID` are distinct bindings.

After final graph/listener acknowledgement, and before resuming the proof child,
`registerNormalProof(binding:proofURL:responseSHA256:helper:readyBackend:)` requires
the same qualifier, fresh blocked lease, actual prepared helper pin and real
backend discard/ready acknowledgement. The Provider independently validates the
signed XPC peer, full audit incarnation, expected live path/hash/CodeDirectory,
UID, Root/epoch/provider generation, current graph and exact owned listener.
The request has no proposed proxy port. The returned port comes from that graph.

The new `YNXRouteFilterProviderSHA256` must be supplied by the packaging owner
from the actual reviewed signed Provider executable and sealed in both apps.
There is no fallback to an acceptance pin. A missing pin refuses DATA preparation
before child startup. Profile/target metadata originate from the normal parent;
the filter binds that metadata to the registration, and does not read profiles.

The immutable proof helper calls `RoutedNormalProofChildAuthority.preflight()`
before parsing informational binding, then `begin(binding:)`. Only the matching
signed Provider channel can construct its private owner. Exact HTTPS GET, one
public nonce path, expected body SHA, no body/redirect/alternate target, monotonic
750ms child lease and per-request refresh apply. Closing either scope channel,
parent/preparation loss, graph replacement, filter stop, sleep or stale process
revokes the grant and drops retained proof flows. Dedicated scope connections are
invalidated so the actual helper callback cancels in-flight URLSession work.
Known child tokens remain denied; cleanup does not unprotect an UNKNOWN child.
Sleep clears scopes; only a fresh explicit operation can register again.

The Provider scope is **not** a release qualifier. The original normal
`RoutedProductionQualification.acquireCurrent` still performs real identity
intake and refuses because the original release owner has supplied no genuine
Browser privacy approval/current/revocation contract. It is not replaced by a
health acknowledgement, QA canary, caller public key or signed resource file.

Run the new offline delta only:

```sh
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/test_normal_proof.py --output "$RUNNER_TEMP/ynx-normal-proof"
```

Artifact: `ynx-normal-proof/**`. The reducer exercises DATA only. The actual
helper tests reject NoTeam before IPC. Normal/QA Provider typechecks and Native
consumer compiles do not prove signed XPC, activation, DNS or full-window safety.

## Public native API findings

Apple provides per-data-store proxy configuration and a public native Lockdown
setter. These are legitimate candidates for a constrained public-data network
diagnostic; neither API is a process-wide firewall. Proxy failover can be
disabled without installing an NE filter. [ProxyConfiguration](https://developer.apple.com/documentation/network/proxyconfiguration),
[WK data-store proxy API](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/proxyconfigurations),
[native Lockdown](https://developer.apple.com/documentation/webkit/wkwebpagepreferences/islockdownmodeenabled).

Official WebKit snapshot `ce4df78bd3b06d1cd763458253db65655617731f` passes NW
proxy configurations into its NSURLSessions. Its preferences disable both
PeerConnection and WebTransport under Lockdown. This explains a narrower native
candidate, and does not bind that source tree to the installed framework.
[Session source](https://github.com/WebKit/WebKit/blob/ce4df78bd3b06d1cd763458253db65655617731f/Source/WebKit/NetworkProcess/cocoa/NetworkSessionCocoa.mm),
[preference source](https://github.com/WebKit/WebKit/blob/ce4df78bd3b06d1cd763458253db65655617731f/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml).

DNS is especially version-sensitive: official fix `f996150fd48e5458a28b3840457310adbba4b2e5`
addresses prefetch using the system resolver despite a configured proxy. The
reviewed main snapshot contains `canPrefetchDNS` returning false for NW proxies.
The installed framework's `22625.2.5.11.1` version has **not** been mapped to that
fix. No private test SPI was invoked and no DNS-safety claim follows from headers
or upstream code. [Official DNS fix](https://github.com/WebKit/WebKit/commit/f996150fd48e5458a28b3840457310adbba4b2e5).

Still unproved for a native-only candidate: actual target DNS resolution, engine
prefetch in the shipping build, trust/certificate and OS auxiliary requests,
backend control-plane DNS, active WSS/download/IPv6 cutoff and crash/recovery.
The current NE architecture is designed to enforce exact process/endpoint rules
across these flows; it requires its real signing/activation and OS observations.
This is not a proof that every possible safe architecture requires NE. The
original real IPv4/IPv6 RTC failure is preserved independently of the later
native Lockdown capability observation. A fixed public DDG diagnostic must remain
labelled a network test, without ordinary input, user data or privacy admission.

## Existing release evidence cannot be promoted to an issuer

The inspected `apps/browser/product-release.json` is historical
`ynx.product-release.v1`, explicitly `productionSigned:false`. Browser packaging
records and `ynx-chain-release-manifest/v1` bind artifact hashes; they do not sign
privacy approval. `scripts/verify/sdk-release-verify.mjs:157` verifies optional
SDK Ed25519 signatures using a caller-supplied public key and a different package
domain. It supplies neither a Browser approver trust anchor nor a current privacy
approval contract. Reusing it for that purpose would create a new trust authority.
The missing original issuer callsite remains `acquireCurrent(mode:)`, with the
same authentic reference needed by `requireCurrent`; this is remaining owning
composition CODE/contract, separate from the missing Apple Team.
