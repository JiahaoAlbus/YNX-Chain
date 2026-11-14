# Nym directory response cache observation

Apply `cache-observation.patch` to the source manifest referenced by
`source-pin.json`. The patch attaches a diagnostic to each completed
HTTPS response-header read in the compile-time QA directory transport.
It does not alter resolver, verified TLS, HTTP, time budgets, epoch checks,
server selection, directory qualification, or production admission.

Each sideband record identifies the resource and page, HTTP status,
local wall-clock time and elapsed duration. Date is restricted to
IMF-fixdate and the consumer verifies the calendar and weekday before
normalizing it to UTC. Age is bounded to a decimal u32. Cache-Control
retains only named booleans and delta-seconds. Unknown directives, quoted
arbitrary arguments, raw response fields, and all response body bytes are
excluded. Missing and invalid values remain distinct. This telemetry is not
a trusted clock, an origin proof, or a reason to route with an elapsed epoch.

For an authorized successor build, wrap the existing decoder and terminal
body/epoch diagnostics in `TerminalHttpObservation`. Pass that observer to
the existing fresh-directory function as both its decoder and its diagnostics
argument. After it returns, use `persist(case, sha, save)` to bind accepted
records to the original terminal receipt and process. This adapter is
diagnostic-only and keeps the original outcome. Running the existing fixed
855806 binary yields no new HTTP observation records.

The Browser's existing `npm run test:nym-backend` discovers
`test_directory_http_observation.py`. In a separately available Rust source
checkout with its locked toolchain and the patch applied, run:

```sh
cargo test --locked --offline -p nym-http-api-client --features ynx-qa-directory qa_cache_observation
```

No public request is made by either test. An exact artifact with this
response-side Rust diagnostic requires a new isolated vendor build.

## Reproduce the complete QA directory CLI

`build-vendor-successor.py plan` seals the exact base executable, base
source, two overlay leaves, Cargo.lock, offline cache provenance, toolchain
and commands. It writes a new plan on the external work volume and exits.
An existing plan is immutable. When using a frozen Browser source cohort,
verify the controller SHA from the plan, then substitute the cohort root
for `REVIEWED_SNAPSHOT` in its commands. Repository inputs in the plan are
relative to the `successors` directory in that cohort.

The plan records separate `stage`, `execute`, and `verify` commands. Use
`/usr/bin/python3 -IB` for each. The first two require the original shared
build lock and fresh capacity. Staging keeps an independent copy of the
source, public dependency cache and target on the external volume. Exact
cache and source bytes are verified before the locked, offline release
build. The cloned target may miss Cargo fingerprints after the path moves.
Each stage has 885 seconds of work and a 15-second cleanup reserve. Cargo
has an 870-second cap within its stage. See the plan for disk, memory, and
log ceilings.

Give `execute` the SHA of the original stage receipt. Give `verify` both
original receipt SHAs. Verification checks original child outcomes and
resource samples, exact commands, the two-leaf source delta, unchanged
Cargo.lock, the actual 1.1.88 release version and QA help output, the strict
signature check, and the new diagnostic marker in the executable. The
known build-script timestamp rewrite of `envs/mainnet.env` is accepted
only with identical bytes and unchanged file identity. Run
`check-vendor-successor.py` after creating the plan to exercise the recipe
and receipt controls without invoking Cargo or a public endpoint.

The emitted binary is a QA directory supplier. The existing fresh-profile
runner can consume its bounded capture and the header observer can persist
the new diagnostic records under a fresh, explicitly scoped request.
Keep the separately pinned Mixnet runtime. Use the existing RFC body probe
and fixed DDG probe to distinguish a verified HTTPS response from a search
challenge. Browser download acceptance also needs the installed protected
WebKit download flow, its live route lease, and a controlled destination.
