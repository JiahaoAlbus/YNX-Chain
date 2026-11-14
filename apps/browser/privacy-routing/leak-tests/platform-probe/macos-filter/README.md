# Scoped macOS route filter module

This is the concrete response to the installed WebKit RTC failure. The actual instrument executable SHA-256 `e27080ea6544b6a003d8965cbe0074252a4979e1b8e50c6ecbda1bddfae787f7` sent valid STUN over IPv4 and IPv6 before and after its owned SOCKS endpoint was closed. The preserved live result remains **FAIL**. This module is built, not installed or activated; production route admission stays false.

`build.py` creates a complete containing `.app`, nested `.systemextension`, executable entry points, Info plists, host/provider entitlements, source/binary hash receipt and a separate signing recipe. It uses only the installed public macOS SDK and writes artifacts to a fresh external directory. It does not select an identity, sign, import a profile, notarize, install, activate, replace an extension, save preferences or alter global DNS/proxies/trust.

```sh
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/build.py \
  --output /absolute/fresh-owned-build \
  --test-cohort /absolute/preserved-c-platform-matrix-receipt.json
```

The optional cohort step runs real own-process audit-token/SecCode/path/hash/pidVersion checks and a real own loopback TCP-listener ownership check. It then replays the recorded STUN protocol tuples through the exact reducer compiled into the provider, using explicitly fixture-only identity tokens. Replay does **not** validate a new running system extension. The live original failure is never replaced by a reducer result.

## Actual provider contract

The reviewed run JSON is `ReviewedFilterRun` in `RunPolicy.swift`, schema `P05_REVIEWED_FILTER_RUN_V1`. Required fields are `runID`, UUID `epoch`, `expiresAt` (future, at most 600 seconds), `browser`, `entryOwner`, `entries`, and `backends`. Every `ProcessPin` has a full 32-byte `auditTokenHex`, numeric `pid` and `pidVersion`, exact executable `path`, SHA-256 and an explicit SecCode `requirement`. Every backend also has exact full `responsibleAppTokens` and a bounded list of literal-IP, port and TCP/UDP `destinations`. No wildcard, arbitrary hostname resolution or all-backend-UDP permission exists.

The extension validates the live full audit token with `SecCodeCopyGuestWithAttributes(kSecGuestAttributeAudit)`, `SecCodeCheckValidity`, `proc_pidpath_audittoken`, process start identity and executable hash. It decodes the public token using `audit_token_to_pid`/`audit_token_to_pidversion`, rather than treating a PID or bundle name as an incarnation. The review must pin the actual Browser and each Tor/Nym/PT child separately. A backend whose OS responsible app is Browser is recognized by its independently pinned `sourceProcessAuditToken` before applying Browser-only rules.

On each new flow the provider checks only app/process identity tokens before determining scope. Unrelated applications get `.allow()` immediately; their URL, endpoint, payload and flow object are neither read nor logged. For the enrolled Browser, only outbound TCP to an exact loopback SOCKS entry is allowed, only while explicitly connected. OS-created WebKit Networking/WebContent source-process tokens are checked with Apple's code requirement and public process identity; they are not rejected merely for having a different process token from the UI. Browser DNS, RTC UDP, direct IPv4/IPv6 and another route entry are dropped. Nil/invalid source-process identity for a matched Browser is dropped.

Each backend may bootstrap/reconnect only to its exact reviewed TCP/UDP peers. The entry-owner backend can accept inbound loopback TCP only at the reviewed proxy listener while connected. Blocking Browser flows preserves the independent approved backend transport, so a managed Tor/Nym/PT child is neither mistaken for Browser nor granted all UDP access.

Startup is blocked. A signed authenticated host must send a matching run/epoch, next sequence, explicit user action reference and connected request. The provider verifies the exact entry-owner token/code/hash and its real loopback TCP listening FD via public `proc_pidinfo`/`proc_pidfdinfo`. Missing permission fails closed. A watchdog checks reviewed lifetime/root/listener liveness; route loss, control interruption, sleep/wake or an invalid state blocks retained Browser/entry flows with public `update(_:using:for:)`. It never auto-reconnects Browser when the original listener returns. A new explicit user request is required. Backend transport can continue only within its fixed reviewed destinations and lifetime.

The host/provider control channel uses public `NSXPCConnection.setCodeSigningRequirement`, checked by XPC on messages, with exact Team ID and bundle identifiers. No private `auditToken` selector/KVC, PID-only authorization or unauthenticated local JSON socket is used. The host remains alive for the run and its connection owns enrollment. A separate status connection closing does not disconnect that run. A lost owner connection blocks Browser; reacquisition must have the byte-identical reviewed manifest and preserve sequence/epoch.

## Native owner integration

Before creating a protected `WKWebsiteDataStore`/WebKit instance, Native must obtain **its own** public `TASK_AUDIT_TOKEN`, write its exact process pin and current route-child pins into the private reviewed manifest, and enroll through this separately authorized signed host. It must keep WebKit absent until the OS extension is active, enrollment matches the exact audit token/epoch and the actual route/listener is ready. The existing instrument's JSON collector readiness alone cannot meet this OS gate. No change to Native main/probe/shared is made here.

Route state JSON is `RouteStateRequest`: `runID`, `epoch`, monotonically next `sequence`, `state` (`connected`/`blocked`), and `userActionReference` (UUID for an explicit connect request). The reference records Native intent; it is not fabricated proof of a human action or successful network routing. The host accepts only private current-user owned, nonsymlink regular files of bounded size. Keep the manifest and state file in one private run directory.

The protected Browser must be a **dedicated routed LaunchServices application instance**. A normal Standard window sharing the same process shares the same app audit token and cannot be selectively excluded by this filter. Parent Native therefore owns the per-mode `NSWorkspace` new-instance launch/bundle setup. Enrollment uses only that exact routed instance's token, never every process of the product's bundle ID. A distinct Standard instance is unowned and is immediately allowed without endpoint/payload reads.

The host must itself be registered/launched as a separate LaunchServices app; direct execution as a CLI child of another app is not accepted evidence of correct OS responsibility. After the original owner installs the signed bundle, explicitly registers/launches it, and the user approves activation/configuration, a controlled synthetic canary must verify the actual NE callback `sourceAppAuditToken` equals the routed process token and that WebKit's `sourceProcessAuditToken` has the trusted Apple code identity. The provider exposes only enrolled-run match counts and verified WebKit tokens for this check. A missing/mismatched token keeps source-app responsibility **UNKNOWN**. Neither a process parent chain, bundle ID, XPC handshake nor a self-reported ready Boolean substitutes for this real callback gate.

After a signed/installed provider and explicit user system authorization exist, use a LaunchServices launch (the source build never executes it):

```sh
/usr/bin/open -n '/Applications/YNX Route Filter Host.app' --args \
  --serve-reviewed /absolute/private/run.json EXACT_MANIFEST_SHA256 /absolute/private/state.json
```

The source build defaults to `NOT_CONFIGURED`; activation/configuration/control exit 78 before calling the system APIs. No-argument invocation only prints commands. Explicit activation/configuration commands are separate reviewable actions, do not silently replace another installed version/configuration, and are not run by this workflow.

## Actual missing permissions and validation

On this host, `security find-identity -v -p codesigning` returned `0 valid identities found`. The instrument is ad hoc signed and has no Team ID/NE entitlement. Building the module is not a Developer ID signature. The original signing owner must supply an authorized Developer ID Application identity and matching entitlement-enabled provisioning profiles for both targets, choose the actual Team ID, rebuild, review `sign-reviewed.sh`, sign/notarize as required, and obtain explicit user approval for system extension activation and the dedicated content-filter configuration. This module never accesses/exports keys or purchases/enrolls an Apple account.

**Not run:** signed provider load, real audit-token attribution in NE callbacks, new OS-enforced RTC/DNS/IPv6/WSS/download fault matrix, provider crash/restart, uninstall/config removal, OS Wi-Fi switching/sleep/wake, or production admission. In particular, a native IPC watcher is not proven to close every race if the OS disables/crashes the filter. No public fail-closed crash guarantee was established here. The production gate must stay false until those actual lifecycle and source-app attribution gates pass. Filter callbacks with missing app attribution for shared system DNS cannot be converted into whole-machine DNS capture or ordinary-app blocking.

Primary API sources: [source process audit token](https://developer.apple.com/documentation/networkextension/nefilterflow/sourceprocessaudittoken), [source app audit token](https://developer.apple.com/documentation/networkextension/nefilterflow/sourceappaudittoken), [filter sockets](https://developer.apple.com/documentation/networkextension/nefilterproviderconfiguration/filtersockets), [Network Extensions entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.networkextension), [Apple filtering sample](https://developer.apple.com/documentation/networkextension/filtering-network-traffic). Installed SDK `NEFilterSettings.h` additionally documents that explicit loopback filter rules are required; the module includes those rules. Firewall grade sets filter priority, not proof of crash behavior.
