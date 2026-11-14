# P05 C: synthetic privacy route leak harness

This directory owns synthetic local test endpoints and an evidence classifier. It does not implement Tor/Nym, install a packet collector or trust root, alter system proxies, use privileged capture, inspect real browsing, or open a routed browser mode. Parent platform admission remains false in `native/Sources/YNXBrowserCore/PrivacyRouteProvider.swift`.

## Run the affected local tests

From the existing Browser worktree:

```
node --test apps/browser/privacy-routing/leak-tests/tests/*.test.mjs
```

The tests are also discoverable by the product's existing `node --test` command. No package, lock, native or CI workflow change is required.

`synthetic-endpoints.mjs` binds only `127.0.0.1` and, when available, `::1`, on ephemeral ports. The HTTPS server serves one generated `<run>.leak.test` Host, a WebSocket upgrade, a synthetic download and a browser probe page. UDP DNS serves only this exact synthetic name with A/AAAA loopback answers; it never recurses or forwards. UDP STUN sends a standard XOR-MAPPED-ADDRESS response using only the loopback peer. No unrelated DNS name is logged. IPv6 listener unavailability is explicit in the manifest and must not be reported as IPv6 coverage.

`temporary-tls.mjs` creates a one-day local CA/server certificate and keys under a private system temporary directory and deletes them on ordinary cleanup. Tests explicitly trust that CA only inside their Node TLS client. No private key enters the repository, output manifest or evidence receipt. No OS/browser trust setting is installed. Killing the process can leave a scoped `ynx-p05-leak-ca-*` temporary directory; it contains no user identity and is not a product certificate. Do not bypass WebKit certificate trust for external browsing.

The probe page starts HTTPS/WSS/WebRTC only after its button is clicked, with a separate download link. It creates a data channel without media access. It prints candidate type/family, not raw candidate addresses. Supplying this page and running Node TLS tests does not mean a WKWebView executed it. `.test` resolution and genuine browser-side routing need their actual owned integration; these tools do not edit hosts or system DNS.

To run controlled loopback servers until SIGINT/SIGTERM and save synthetic public receipts outside the repository:

```
node apps/browser/privacy-routing/leak-tests/runner.mjs --serve /tmp/ynx-p05-synthetic-receipts.json
```

## Evidence and verdicts

`fixtures/normalized-trace.mjs` is a deterministic classifier fixture, not captured browser traffic. `assessLeakSuite` accepts `YNX_SYNTHETIC_LEAK_TRACE_V1`: mode, exact source HEAD, synthetic `.test` domains, exact route-entry endpoints, and separate bounded baseline/killroute/wifiswitch/sleepwake/crash runs. Each run describes client process-tree plus synthetic-DNS scope, UI/WebContent/Network/route/resolver roles, TCP/UDP/DNS/IPv4/IPv6 coverage, loss count, capture window and raw capture digest, controlled target observer completeness, and ordered run-bound events.

Events distinguish `probe`, client/route `flow`, `dns`, target `receipt`, `ice`, `state` and `fault`. `destination` is `{transport,host,port}`; `probeID` correlates a synthetic request across app, route and target. An observed client flow to the target instead of the exact route entry is a failure, including IPv6/UDP/STUN. Client DNS outside the route is a separate failure. IP-bearing host/srflx/prflx ICE candidates fail independently of HTTP exit address; an mDNS candidate is not itself accepted as an IP leak or proof of safety.

The baseline requires separate route-to-target and target receipts for HTTPS/WSS/download. Each fault requires a blocked readback before subsequent probes, all protocol probes blocked, at least five seconds of continuous scoped observation, and no new probe dispatch or target receipt. Unattributed receipts remain incomplete because they could be pre-fault in-flight effects. Missing capture, process coverage, IPv6/UDP/DNS, raw binding, controlled observers, exercised probes or correlation can never produce an analysis PASS.

```
node apps/browser/privacy-routing/leak-tests/runner.mjs --assess /absolute/synthetic-trace.json
```

The CLI hashes its input and returns exit 1 for FAIL, 2 for NOT_RUN/INCOMPLETE. `analysisVerdict: PASS` means the supplied normalized model meets classifier rules. `targetVerdict` is always NOT_RUN/INCOMPLETE/FAIL in this implementation; no caller-supplied admission Boolean upgrades normalized logs into actual network proof. There is deliberately no target PASS path until an independent client capture adapter and platform isolation proof are supplied. `opensRouteMode` is always false. Curl success, changed public IP, proxy-process health, server logs or an app's own JSON do not prove WebKit has no bypass.

## Actual remaining gates

No Tor/Nym real-route browser capture, OS Wi-Fi change, OS sleep/wake, engine crash, global proxy action or GUI has been performed by C. Actual installed synthetic-only WebKit and owned proxy-closure runs are described below; they do not replace the original four classifier fixtures with claims about real OS faults. Raw packet decoding/complete XPC responsibility coverage is not supplied. UI-root-only observations are insufficient. Current public API assessment and primary sources are in `WKWEBVIEW_PUBLIC_API_REVIEW.md`.

## Executable unprivileged collector and owned fault runner

`scoped-collector.mjs` now performs real macOS `ps` identity/ancestry reads, then invokes `lsof -nP -a -p <explicit-owned-PIDs> -i -F0pfPnT`. Process selection happens before any socket observation. It never captures whole-machine DNS and filters it later. Only the selected dedicated test root and its proven descendants are included; unrelated WebKit processes are excluded. Unknown remote endpoints are redacted. Transport is part of endpoint identity: UDP to a TCP proxy's numeric port is not treated as routed.

These are FD snapshots, not packet capture. They can miss short-lived traffic and cannot establish DNS/UDP payload non-emission. The actual permission-only `/dev/bpf0` open returned EACCES on this host; zero bytes were read. `launchctl procinfo` returned `This subcommand requires root privileges: procinfo`. The tool does not escalate or retry privileged APIs. Parent-chain descendants with exact system WebKit executable paths can be identified as UI/Network/WebContent roles; launchd-owned XPC processes remain unattributed rather than being collected by global process-name matching.

The following command launches only C's own Node helper subtree and the loopback synthetic servers:

```
node apps/browser/privacy-routing/leak-tests/owned-fault-runner.mjs --local-faults --output /tmp/p05-owned-fault-receipt.json --intentional-direct-negative
```

It establishes a real local CONNECT tunnel and verified end-to-end TLS, correlates client-to-route and route-to-target sockets with the target's synthetic HTTP receipt, then exercises actual owned-process SIGTERM/SIGKILL, controlled socket link loss, and SIGSTOP/SIGCONT. The latter two are explicitly **not** actual Wi-Fi or system sleep. Post-fault probes read back blocked and create no new target request. An optional intentional direct-only loopback negative is detected independently by the network child's direct target socket and the controlled target receipt. Helpers, child PIDs, temporary keys and sockets are cleaned up. `observedHelperContract` is a bounded helper integration result; it never changes `targetVerdict: INCOMPLETE` or route admission and never claims WebKit passed.

For an exact future QA executable, a read-only binary preflight is available:

```
node apps/browser/privacy-routing/leak-tests/owned-fault-runner.mjs --preflight-client /absolute/YNXBrowser.app/Contents/MacOS/YNXBrowser --sha256 EXACT_SHA256
```

It hashes the exact executable and launches nothing. The parent product owner must supply the actual reviewed synthetic-only startup contract: no normal tab restoration, no DuckDuckGo/default external page, isolated defaults, only run-bound synthetic targets, and the exact argument `--p05-synthetic-run=<runID>`. A marker alone is not enforcement evidence. C does not alter the native client to create that contract.

Once that dedicated client has been started by the product owner, the collector can execute against its exact root:

```
node apps/browser/privacy-routing/leak-tests/owned-fault-runner.mjs --observe-client /absolute/scoped-observation.json
```

The config is:

```json
{
  "rootPID": 12345,
  "executable": "/absolute/YNXBrowser.app/Contents/MacOS/YNXBrowser",
  "expectedSHA256": "<64 lowercase hex>",
  "runID": "owned-synthetic-run",
  "routeEndpoints": [{ "transport": "tcp", "host": "127.0.0.1", "port": 19050 }],
  "syntheticTargets": [{ "transport": "tcp", "host": "127.0.0.1", "port": 19443 }],
  "samples": 3,
  "output": "/absolute/scoped-observation-receipt.json"
}
```

Transport defaults to TCP if absent; DNS/STUN target endpoints must explicitly use UDP. The collector verifies exact root executable/hash and dedicated marker before observing sockets; it does not emit process arguments. It takes bounded samples, records attribution gaps and raw permission results, and returns exit 2 / INCOMPLETE even when snapshots are available. It does not signal an arbitrary existing app or alter any machine network setting. Only helper processes created by the fault runner can be killed/suspended by its fault commands. Trusted target TLS/DNS and full WebKit XPC attribution/packet coverage remain separate actual gates.

## Actual installed synthetic-only binary integration

`installed-probe-runner.mjs` consumes an exact, already reviewed/signed installed Browser executable whose synthetic branch rejects malformed flags before ordinary startup. Do not point it at an old or unreviewed binary: a SHA alone does not establish that startup contract. It writes fresh run-bound manifests, starts only that explicit executable with `--p05-synthetic-run` and `--p05-probe-manifest`, consumes native PID/manifest-bound event files, invokes the exact-PID collector, and actively terminates only its own child handles. It never starts or attaches the ordinary Browser instance or uses a GUI tool.

```
node apps/browser/privacy-routing/leak-tests/installed-probe-runner.mjs \
  --executable '/absolute/reviewed.app/Contents/MacOS/YNXBrowserNative' \
  --sha256 EXACT_SIGNED_EXECUTABLE_SHA256 \
  --source-head EXACT_REVIEWED_40_CHARACTER_SOURCE_HEAD \
  --output-directory /absolute/owned-receipts
```

`scoped-socks-fixture.mjs` is the required **controlled SOCKSv5 fixture**, not Tor or Nym. It accepts only this run's domain (or explicit loopback IPv4) and exact target port, resolves the synthetic domain only inside the fixture to loopback, and rejects other targets/commands. It cannot be used as a general proxy. Its native integration scenarios are normal TLS rejection using a temporary untrusted local CA and intentional SOCKS CONNECT refusal. The CA is never installed or injected into WebKit, and system trust is never bypassed. A separate Node calibration proves the same tunnel works with explicitly supplied test CA and rejects that certificate without it; that is not a WebKit trust-root diagnosis.

The installed runner also executes the reviewed malformed run-flag and manifest-only negative invocations and requires exit 78 before attempting live probe scenarios. Each native run uses a new ID and private manifest, preserving existing probe directories. Its receipt contains the exact executable hash, source reference, input manifest hash, launched PID, ordered native events, controlled SOCKS/TLS target logs, scoped observations and actual signal/exit cleanup. Native output directories are preserved as first-cause evidence; temporary TLS keys and fixture listeners are removed. The CLI returns 2 / INCOMPLETE, including when these controlled negatives execute correctly.

The first actual installation run used source `99331e0873e320c34a0cc07969eda308e63bc015` and executable SHA-256 `e4b58806cebe6f70e54cef205a2d9bd95de6c30c34b5b8d527dcffa2fffc12bd`. Both malformed cases returned 78. Normal TLS reported `NSURLErrorDomain:-1200`; controlled target logged ECONNRESET and no HTTP request. This is a normal TLS-path block, **not proof of its precise certificate cause**. SOCKS refusal reported -1000 with no target connection. Both native runs requested the correct domain using SOCKS ATYP3, but that does not prove absence of a separate DNS/UDP/WebRTC path. UI-root FD snapshots contained zero sockets and could not attribute launchd WebKit auxiliaries. Raw BPF was still EACCES. All of those limitations remain in the receipt; none opens route admission or counts as a default DuckDuckGo/ordinary browsing flow.

## Real WebKit platform matrix and the RTC failure

`platform-matrix-runner.mjs` consumes the exact candidate JSON for a reviewed synthetic-only installed binary, rehashes it, supplies a hash-bound local HTML network instrument, waits for the exact PID collector and drives baseline → owned SOCKS closure → explicit after-fault phase. It never starts ordinary BrowserController/profile/restore/DDG/Wallet. The instrument uses the real fetch/WebSocket/download/frame/RTCPeerConnection APIs; it does not replace them to simulate isolation. IPv4 and IPv6 STUN targets are bound only to owned loopback ports. Target TCP and SOCKS upstream source ports are correlated, so route entry and target connections are not confused.

```sh
node apps/browser/privacy-routing/leak-tests/platform-matrix-runner.mjs \
  --candidate /absolute/reviewed/candidate.json \
  --output-directory /absolute/owned-receipts \
  --identity-tool /absolute/public-process-identity-helper \
  --local-routed-only
```

The public helper compiles with `xcrun clang -fobjc-arc platform-probe/ProcessIdentity.m -framework Foundation -framework Security -o /absolute/helper`. It uses public audit-token/self task APIs, proc start/path data and SecCode checks; no process-name guessing or private responsibility API. An endpoint-selected `lsof` query matches the accepted SOCKS peer source port and this run's exact domain handshake, then verifies the actual Apple WebKit Networking process identity. This establishes only those controlled 5-tuples. UDP FD queries additionally require a previously verified owned SOCKS-peer PID and source ports learned from the owned STUN server, with exact connected destinations distinguished from weaker unconnected-port correlation. No other sockets of a shared XPC PID are collected.

The actual `instrument-205052-490e` executable SHA-256 `e27080ea6544b6a003d8965cbe0074252a4979e1b8e50c6ecbda1bddfae787f7` produced **FAIL**: both baseline and after proxy closure sent IPv4/IPv6 STUN and generated srflx candidates. Apple-signed Networking PID 50457 was tied to the exact controlled SOCKS and UDP tuples; no full UI→all-XPC ownership is claimed. HTTPS/WSS/download stayed blocked on the local normal TLS path; downloads were not completed. Zero post-fault target TCP is not a no-leak PASS because real RTC UDP bypass was independently observed. The original direct negative control calibrated the observer; it is not routing protection.

The executable OS-filter repair module, complete app/systemextension structure, exact token/backend policy, build/test commands, signing/activation chain and unresolved actual deployment gates are in [platform-probe/macos-filter/README.md](platform-probe/macos-filter/README.md). Its build and reducer replay do not replace the original RTC failure. No eligible signing identity was available, no provider was installed/activated, and production admission remains false. Standard and routed windows must use distinct real LaunchServices app instances/audit tokens; the filter never enrolls the whole Browser product by bundle ID.

## Public nonce fixture and readiness

`public-nonce-fixture.mjs` exposes only generated run-bound proof/download/WSS bytes at `/ynx-route-probe/<runID>/`; there is no file-serving/proxy/credential-reading endpoint. Its origin transport is explicitly loopback HTTP. External HTTPS trust is independently required. `platform-probe/quick-tunnel.mjs` starts only an explicitly approved short-lived Cloudflare Quick Tunnel with empty config and clean environment. It installs no service or account and changes no DNS/proxy/trust. Approval is obtained by the original parent, not manufactured by a CLI string.

`--public-only --approval-reference EXACT_EXISTING_HUMAN_DECISION_REFERENCE` provisions at most two processes for that authorization. An exclusive external budget reservation prevents blind repetition of the same approval. There is no replacement provisioning. URL allocation is not readiness: each original process must register, and normal HTTPS to each same exact origin must return status 200 and the expected SHA-256 nonce body before any WebKit public matrix starts. Redirects, arbitrary HTTP 200s, certificate overrides and error pages never satisfy the gate. Current readiness allows up to 240 seconds for DNS propagation inside the original ≤300-second tunnel lifetime, leaving time for the actual matrix and cleanup.

Four human-authorized tunnels were actually consumed across two bounded attempts. The first pair was prematurely stopped by the tool after immediate ENOTFOUND before registration; this own timing failure is preserved. The second pair both registered, but all normal getaddrinfo attempts in the then-60-second readiness window returned ENOTFOUND, so no public WebKit instance was launched. After cleanup the same synthetic names had successful normal A/AAAA lookups mixed with ENOTFOUND across lookup/resolve4/resolve6. The short window may have missed propagation or intermittent resolution; the precise DNS cause and permanent availability are not established. The window was corrected to 240 seconds but was **not rerun**, because all four authorized tunnels were already consumed. No fifth tunnel is started automatically. Public TLS/protocol positive, cross-origin success and completed real-WebKit download remain NOT_RUN.

## Minimum scoped administrator capture review

`platform-probe/capture-plan.mjs` prepares a self-contained administrator executor and SHA-bound review for only the current run's exact owned nonprivileged lo0 TCP/UDP listener tuples. It never uses pktap, all-DNS capture or `-Q` user-space filtering. The generated command does not elevate itself, verifies the live reviewed owner/listener, opens exclusive no-follow output FDs, waits for tcpdump listening readiness, runs a bounded capture and preserves early/nonzero failures. ChildProcess handles are used for signaling; a failed capture is never printed as complete. Ordinary-user execution actually returned 77 before opening a pcap.

An explicit future `--local-routed-only --wait-reviewed-capture` run prints the exact fresh review/command and waits at most 22 seconds for a root-owned run+plan-bound capture readiness file before it permits native collector readiness. A missing capture cancels before creating WebKit. The current completed runs' listener tuples are stale and their scripts refuse reuse; a new exact run is required after explicit administrator authorization. This optional lo0 capture still does not cover non-loopback egress, shared system DNS or prove complete XPC responsibility, and cannot produce route PASS.
