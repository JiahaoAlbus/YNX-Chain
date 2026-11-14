# Fixed Snowflake PUBLIC QA phase observations

This fixture is not browser isolation, production qualification or release approval. It opens no
socket itself and changes no production Native source. The first network experiment and its
512-line trace remain sealed in `snowflake-reviewed-once-v2`; the new parser cannot recover text
which that experiment omitted. No second relay has run.

`SnowflakeSafePhaseRecorder.swift` consumes the exact owned Arti stderr bytes in memory, in
addition to the unchanged general trace. It recognizes anchored Snowflake standard-log messages
and Arti `tor_ptmgr::ipc[::sealed]: [pt ...] ...` log envelopes. Only fixed labels, HTTP status
integers, the three upstream NAT enum values, monotonic time and counters are passed to the
existing safe trace. Unknown messages, URLs, relay names, SDP, ICE identifiers, PT labels and
dynamic error tails are not returned. No raw log file, FIFO, unsafe logging or logging argument
is enabled. The recorder has independent 2 MiB input / 8192 complete lines / 8192 bytes per line /
256 events / 650 seconds limits; reaching a cap means coverage is truncated, never successful.
Unknown lines do not consume the phase-event allowance. The existing trace's overall cap still
applies; even a recorder label is not proof that the event was durably captured.

The source is the actual binary's replacement dependency, not nominal Snowflake v2.14.1:
`v2.11.1-0.20260305220527-3e42aebe21a5`, commit
`3e42aebe21a57f14f47d4312ce5fbc8adf039d84`, Go source sum
`h1:tAsl5dUdCSJmCH4sCsxHEnHRlgBJMk7feHjsrBA2VNU=`.

| Label | Exact dependency source | Meaning and limitation |
| --- | --- | --- |
| brokerHTTPAttempt / brokerHTTPResponse | client/lib/rendezvous_http.go:38,64 | Request attempted / parsed HTTP status, not a successful Tor bridge |
| brokerAnswerParsed | client/lib/webrtc.go:238 | Negotiate returned an answer; before SetRemoteDescription |
| NATCheckFailed / NATResult | client/lib/snowflake.go:291; rendezvous.go:182 | Upstream NAT observation, no server address/error detail retained |
| STUNAddressResolutionFailed | common/nat/nat.go:164 | Address resolution failed; not an ICE or TLS diagnosis |
| remoteDescriptionRejected | client/lib/webrtc.go:241 | SetRemoteDescription rejected; no SDP retained |
| covertDTLSSetupFailed | client/lib/webrtc.go:306 | Covert DTLS settings failed; not a DTLS handshake observation |
| dataChannelOpen / dataChannelOpenTimeout | client/lib/webrtc.go:331,253; snowflake.go:419 | Data channel opened / known timeout; no separately observed ICE/DTLS success claim |

The fixed Lyrebird binary's actual no-network `-help` reports `-logLevel` default ERROR,
`-enableLogging` writing `TOR_PT_STATE_LOCATION/lyrebird.log`, and `-unsafeLogging` disabling
its address scrubber. These flags alone do not prove how that devel root wires the Snowflake
standard logger. Arti's locked tor-ptmgr 0.47.0 source `ipc.rs:477-485` forwards PT LOG messages
at a severity-dependent level. The new recorder recognizes a safe message *if emitted*; actual
fixed-binary emission at the current settings is NOT_RUN. Exact root Lyrebird source/patch set
is not recovered merely from its version label or a later cached root revision. No file logging
is permitted as a silent substitute for a proven bounded stream.

Independent offline test, with an owned fresh output directory:

```sh
python3 apps/browser/privacy-routing/tor/tests/test_snowflake_safe_phases.py \
  --synthetic-only \
  --output /absolute/path/to/fresh/owned/results
```

It compiles the actual recorder with the QA macro, checks its normal no-QA compilation, runs
synthetic split/long/capped/late streams, and records source hashes and child exit receipts.
It does not run Lyrebird, use a profile, construct authority or validate network isolation.

CI's synthetic invocation needs no official-source download or local WD path and explicitly
reports official provenance NOT_RUN. Source-marker provenance is a separate invocation with
`--exact-snowflake-source /absolute/genuine/module --provenance-only --output /fresh/results`.
It checks supplied constants and records hashes without running the twelve stream groups again.
Its supplied hashes must be matched to the reviewed Go-module sum outside that marker check;
this mode does not turn an arbitrary source tree into an official source. Neither mode downloads
source or substitutes a fake tree. The existing same-source functional receipts remain intact.

## Remote candidate boundary

Snowflake `client/lib/webrtc.go:275-284` sets Pion's IP filter and disables mDNS when
`keepLocalAddresses=false`. Actual Pion webrtc v4.2.3-securityfix `settingengine.go:300-305`
documents this as candidate gathering; `icegatherer.go:246` passes the filter to ICE. It filters
local gathered candidates, not every remote destination. Remote SDP is passed directly to
`SetRemoteDescription` at Snowflake line 239. Actual Pion ice v4.2.0 `agent.go:891-897` refuses
remote host `.local` candidates while mDNS is disabled; numeric candidates then reach
`addRemoteCandidate` at lines 1018-1051, which stores/pairs them and requests connectivity checks
without that IP filter. Remote private/loopback/link-local rejection is NOT_PROVEN. This
experiment cannot authorize arbitrary LAN entry or a normal static NE graph.

The reviewed second relay changes RSA identity while broker/front/ice/utls remain the same.
A subsequent separately authorized fresh case could supply a useful comparison, but random
front choice, STUN subset, broker peers and time also vary. Success there would be compatible
with relay-specific failure here; it would not alone establish the cause. Both failing would
not prove all Snowflake service unavailable. No such new network case is implied by this file.
