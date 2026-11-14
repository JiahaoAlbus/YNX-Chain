# PUBLIC diagnostic FD observer

This is a read-only observer for the separately packaged fixed public-search
diagnostic. It never starts or stops the app/backend, probes BPF permissions,
captures packets, reads DOM/payload/profile files, or claims a WebKit XPC process
by name. It is not a qualification supplier.

For the already installed build22 role, after the GUI owner obtains the actual
CUALaunch PID, run from the repository root:

```sh
node apps/browser/privacy-routing/leak-tests/public-diagnostic-collector.mjs \
  --pid ACTUAL_CUALAUNCH_PID \
  --bundle '/REDACTED_USER/Applications/YNX Tor Public Search QA.app' \
  --expected-sha256 c0d75fd1b1c0503d91ce3302511d4f5b474b8f085142a9f2acab66169d855bb8 \
  --identity-tool '/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P05/privacy-routing/public-diagnostic-collector-20261107/PublicDiagnosticIdentity' \
  --identity-sha256 57caa8e2396e378098f3036327f4147dc7f6aa8062e0c76ff9e85b35d08d2540 \
  --samples 5 --interval-ms 250 --output /ABSOLUTE/FRESH/OWNED/OUTPUT
```

The first verified observation pins `receipt.binding.start` as `seconds:microseconds`.
Subsequent observations of the SAME process can also pass `--expected-start` with
that value. It is the anchor consumed by the separate backend observer. No PID
replacement, relaunch or retry occurs on exit or identity loss.

Before FD reads, the tool checks the exact installed bundle's strict code seal,
true Boolean `YNXPublicSearchDiagnostic`, fixed diagnostic identifier, no route/
proof/URL-handler role, executable SHA and identity-tool SHA. Public libproc and
SecCode then check the selected PID's UID, exact path, current signing identifier,
CodeDirectoryHash and microsecond start before/after the metadata window. The
native helper itself also takes two identity samples to detect a changed process.
The helper is not a process-responsibility or audit-token authority.

Each FD sample runs the original `collectOwnedSnapshot` in a bounded owned worker
group. It includes only the root and actual OS descendants; those descendants are
unclassified until separately verified by the backend owner. Launchd-owned WK
auxiliaries are not adopted. Only FD metadata is parsed; non-loopback addresses
are redacted. A sample is withheld if the root identity changed during it. The
worker has a five-second deadline and an output limit. Only this observer worker
group can receive SIGTERM; the target app/backend is never signalled. An unknown
worker close is recorded and stops further observation, without claiming reaping.

`OBSERVED_INCOMPLETE` means the requested metadata samples completed. Exit code0
does not mean route safety. Exit/identity failure, worker timeout or a partial
window stays explicitly incomplete. Every receipt has `targetVerdict: INCOMPLETE`
and lists packet capture, DNS, complete WK responsibility, external non-emission,
cutoff/crash safety and public target receipts as **NOT_OBSERVED**. Root FD0 or a
page result is not evidence of no packets. The old synthetic-run observer and its
permission probe are unchanged and are not called by this entry.

The helper build is one small native file, not an app/Swift/Provider build:

```sh
xcrun clang -isysroot "$(xcodebuild -version -sdk macosx Path)" \
  -mmacosx-version-min=14.0 -fno-modules -fobjc-arc -Wno-deprecated-declarations \
  apps/browser/privacy-routing/leak-tests/platform-probe/PublicDiagnosticIdentity.m \
  -framework Foundation -framework Security -o /ABSOLUTE/OWNED/PublicDiagnosticIdentity
```

The actual local build/limits, source/binary hashes and preserved first compiler
failure are in the tool artifact directory above. No signing identity is selected.
The linker ad-hoc signature does not supply a Team or release approval.

New focused controls are automatically discoverable by the existing Node test
glob, or can be run alone:

```sh
node --test apps/browser/privacy-routing/leak-tests/tests/public-diagnostic-collector.test.mjs
```

Actual GUI-PID observation is the GUI owner's next action. C validated only new
refusals and an owned no-network sleep process identity, not a running build22
window or its network flows. Build22's frozen app sources and installed bytes
are unchanged by this tool.

## Snowflake exact-role observation

The additional branch accepts only
`com.ynxweb4.browser.qa.tor.public-search.snowflake`, with both PUBLIC Boolean
markers, the actual strict bundle seal, exact signed executable hash and the
selected PID's actual SecCode/start tuple. The original branch and publisher
`PrivacyBackends/Tor/lyrebird` hash
`7c0ac55caec0d0977477cbe3fcba4ea35867d84876af7d61c7f7373b1f2f3e1d`
remain separate. Snowflake additionally checks `PublicSnowflakeQA/lyrebird` hash
`23e2162d3bd439bec0dda06310f9c60ced7bccf35b82db4eb721c0177307387e`.
No prefix, alternate resource path or caller-supplied helper hash is accepted.

Inputs for the new branch are mandatory, even though package/run pins are not
known when this tool is prepared:

```sh
node apps/browser/privacy-routing/leak-tests/public-diagnostic-collector.mjs \
  --diagnostic-role com.ynxweb4.browser.qa.tor.public-search.snowflake \
  --pid ACTUAL_CUALAUNCH_PID --expected-start ACTUAL_SECONDS:MICROSECONDS \
  --bundle /ABS/ACTUAL/INSTALLED/SNOWFLAKE-PUBLIC.app \
  --expected-sha256 ACTUAL_SIGNED_EXECUTABLE_SHA256 \
  --identity-tool /ABS/OWNED/PublicDiagnosticIdentity \
  --identity-sha256 57caa8e2396e378098f3036327f4147dc7f6aa8062e0c76ff9e85b35d08d2540 \
  --run-id ACTUAL_LOWERCASE_RUN_UUID --profile /ABS/ACTUAL/QA/PROFILE \
  --scope-sha256 ACTUAL_SCOPE_SHA256 --launch-sha256 ACTUAL_SEALED_LAUNCH_SHA256 \
  --observation-nonce FRESH_LOWERCASE_OBSERVATION_UUID \
  --samples 3 --interval-ms 250 --output /ABS/OWNED/FRESH/OUTPUT
```

For a first identity observation, `--expected-start` may be omitted; before/after
actual identity checks establish the tuple without attaching a replacement PID.
Later observations and the backend observer reuse that exact start value. The
observation nonce correlates the two collectors' receipts; it grants no authority.

The collector reads only the app's bounded sealed `launch.json` resource, matches
its exact SHA against the caller's reviewed pin and Info seal, and checks the
existing 15-field wire against the reviewed run/profile/scope, helper, source,
bridge and fixed target. Its flat canonical parser retains nanosecond integer
tokens as BigInt rather than rounding them through a JavaScript Number. The
resource is DATA; it does not supply a qualification. The collector never opens
the supplied profile path, its scope file or its keys. Receipts retain the
profile path's hash, not that path. An expired descriptor may still be observed
for read-only cleanup metadata; the tool does not renew its expiry or enable
network access. It classifies only the exact loopback route port63782 for this
role; the original role retains port63779.

Every sample repeats artifact/role/PID/start checks and stays `INCOMPLETE`.
Launchd WebKit attribution, shared resolver traffic, DNS/UDP packet absence,
target receipts, cutoff/crash safety and whole-window privacy remain unobserved.
Only the collector's bounded worker may be signalled; the app/backend is never
started, stopped or retried. No BPF permission probe is invoked.

The new controls exercise role separation, full input binding, exact launch
bytes including integers above2^53, malformed/duplicate/mismatched fields, and
an actual CLI rejection before any file/PID observation. They do not open a
target app or profile and can run independently of the original six controls:

```sh
node --test apps/browser/privacy-routing/leak-tests/tests/public-snowflake-collector.test.mjs
```

The existing `tests/*.test.mjs` glob discovers this file. Actual package, process
and FD observations require the GUI owner's fresh installed inputs; source and
rejection checks alone are not an observation of those inputs.
