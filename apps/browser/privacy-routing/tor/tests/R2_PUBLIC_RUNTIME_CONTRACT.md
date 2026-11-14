# R2 fixed PUBLIC runtime diagnostic

This adds observation to the original adapter. It does not remove the path monitor,
ignore any later satisfied callback, change bootstrap/stop deadlines, authorize a
privacy route, or change normal TLS. Production Tor/Nym stay Blocked.

Only `YNX_PRIVACY_ACCEPTANCE` contains the recorder. Attachment requires the exact
PUBLIC bundle role plus the actual CFBoolean `YNXPublicSearchDiagnostic=true`.
The installed role is `com.ynxweb4.browser.qa.tor.public-search`; the headless CLI
fixture role is `com.ynxweb4.browser.qa.tor.public-search.r2-cli`. CLI execution is
direct, without NSApplication, Launch Services, a window, or GUI automation.

The installed app creates `public-runtime.jsonl` in its exact newly created
`ynx-public-search-XXXXXXXX` scratch. The external observer's captured scratch
path identifies this file; no user profile or broad directory discovery is needed.
The file is created O_EXCL/O_NOFOLLOW, current UID, 0600, below the owned 0700 root.

Each event has a processing sequence, monotonic ingress/processing nanoseconds,
and wall-clock UTC. NWPath fields are status, used interface **types**, expensive,
constrained, and IPv4/IPv6/DNS support booleans. There are no interface names,
addresses, gateways or DNS values. `sameObservable` only compares those fields;
it is explicitly not proof that the actual network is unchanged.

For the fixed managed-obfs4 pair, `fixedBackendComparisonBinding` records
the pinned Arti and Lyrebird identities and the generated config hash. The
normalized config hash comes from the same writer with only SOCKS port, the
local state/cache path, and the Lyrebird executable path replaced by constants.
Bridge entries and their ordering remain part of the hash. Neither raw TOML,
bridge lines, nor local paths are emitted. Match normalized and supply hashes
before comparing bootstrap results. A matching binding covers these config
inputs only. It cannot establish identical network conditions, route behavior,
data already in state directories, or isolation. Old traces without the event
carry no such comparison evidence.

The trace includes the owned Arti PID/start tuple, managed PT direct-parent/path
and double start-tuple observation, stop/SIGINT/SIGKILL **requests**, actual
Foundation terminationReason/status, parser-ready events, controller stages and
failures. PT observation is not a direct-child waitpid/reap receipt.

Stderr is **not retained verbatim**. The bounded retained source bytes are only
hashed/counted. Each complete safe line can retain an upstream timestamp, level,
allowlisted module and fixed source message excerpt. Fixed literals come from
Arti 2.7.0 proxy and tor-dirmgr/tor-ptmgr 0.47.0 (including state.describe()).
Variable suffixes, identities and error chains are omitted. Unknown module or
template, invalid encoding, controls and oversized lines retain only hash/count
and an omission label. Fixed error keyword tags are observations, not full causes.
Unsalted hashes are correlation metadata, not an anonymity guarantee. A rare
error outside the whitelist can remain unresolved; this is not a claim that raw
stderr or every nested error was captured.

Limits: 4096 bytes per retained line, 512 stderr line records, first 262144 raw
bytes hashed, 1024 total events, 8192 serialized bytes per event, 512 KiB total
file, 900 seconds. Excess data is omitted/counted. Any incomplete/capped record
must remain incomplete; it cannot be interpreted as absence of network activity.

New offline CI control (31 checks; no old44, backend or network):

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_r2_runtime_trace.py "$RUNNER_TEMP/ynx-r2-trace-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

Stage the fixed adjacent CLI using an existing same-SDK/source QA Core product
directory, the pinned standalone Native closure, and reviewed Tor resources:

```sh
/usr/bin/python3 -B apps/browser/privacy-routing/tor/tests/prepare_r2_adjacent_cli.py NEW_OUTPUT --qa-core-products QA_CORE_PRODUCTS --native-source FROZEN_NATIVE_CLOSURE --resources REVIEWED_TOR_RESOURCES --seal-only
```

Seal-only stages the configuration, parser, trace and supply code without
executing the bundle. After standard execution admission for the exact bundle,
its separate `--prepare-only` step creates a fresh canonical profile and plan
without starting Arti, opening a socket or sampling the network. The admitted
CLI can then run `test_r2_cli_plan_controls.py` with the prepared directory and
a fresh evidence directory. Those controls check target, port, age and inode
rejection before `RUN-ONCE`, trace creation, monitor start or child spawn.

For a seal-only build, keep the original `PREPARATION.json`. With the original
owner's standard assessment receipt and the terminal `offline-plan` process
receipt plus its adjacent `.stdout` and `.stderr`, record the completed plan:

```sh
/usr/bin/python3 -B apps/browser/privacy-routing/tor/tests/record_r2_offline_preparation.py NEW_OUTPUT --assessment ASSESSMENT_JSON --offline-process-receipt OFFLINE_PLAN_PROCESS_JSON
```

This records `ADMITTED-OFFLINE-PREPARATION.json` after checking the same bundle,
five offline stages, and plan bytes. The supervisor rechecks these inputs. The
recorder runs no executable and relies on evidence supplied by the original
owner for macOS admission and separate network scope.

The runtime command below is an explicitly scheduled network experiment. Before
invoking it, the original owner verifies standard macOS execution admission for
the exact executable, separately authorizes the fresh fixed-HTTPS attempt, and
records the actual argv, port, and profile. Schedule it adjacent to the installed
GUI leg when comparing A and B. The supervisor does not grant admission:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/run_r2_adjacent_cli.py NEW_OUTPUT
```

The supervisor reconstructs the fixed bundle executable and `--run-prepared`
arguments. It rejects mismatched command metadata, a missing sealed executable
pin, and unsafe executable paths before claiming the attempt.

Exactly one attempt is permitted. The corrected independent A fixture starts a
raw owned Foundation Process, with fixed 63780, unchanged seven public bridges,
the same config/environment, and a 600-second bootstrap budget. It does not call
ArtiProcessAdapter.start or the Browser interruption monitor. Its NWPath monitor
only records observable events and does not stop A when the path updates. This
is an explicit experimental difference, not a product fence relaxation: B keeps
the original Browser lifecycle and path stop fence. Path changes prevent a claim
that A/B network conditions were proven identical. Original unused CLI-v1/v2/v3
plans shared the Browser lifecycle and are not valid independent A evidence.
Only after
the actual official-ready parser succeeds does it request the fixed public IANA
HTTPS document once, forced SOCKS5h, normal TLS, no redirects/fallback, 45 seconds,
262144 response bytes. Curl config/environment overrides are disabled. Network
observable fingerprints before/after are recorded without network identities.
The supervisor budget is 720 seconds plus 35 for cleanup. It sends cancellation
to the original CLI only. After an UNKNOWN outcome it retains supervision and
observes cleanup in the same session, including children with a different process
group. Late observed absence is recorded separately from the original outcome.
The CLI is the supervisor's direct child. A managed transport's session absence
does not supply a waitpid result for that transport.
CLI and browser profiles/ports differ and neither reuses the historical QA profile.
HTTP success would prove this particular PUBLIC diagnostic only, not LeakSafe.
