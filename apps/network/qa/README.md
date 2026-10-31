# Independent local QA client

Build a clean complete candidate on macOS ARM64:

```sh
node apps/network/qa/build.mjs --out-dir /absolute/independent/output --expect-head EXACT_40_CHARACTER_SHA
```

`--plan` captures the actual clean/dirty source, exact Go dependency/embed input hashes and target without packaging. The builder refuses dirty source, source changes during compilation, an existing versioned output and `/Applications` output. It uses the existing helper and original CORE proof executable, current embedded PWA, and system clang/Cocoa/WebKit. It does not invoke signing, notarization, installation or alter an existing App. Linker-produced signature observations are recorded separately from publisher signing.

The bundle's normal entries are `YNX Network QA.app` and `START.command`. `START.command --headless` runs the same packaged helper through its normal CLI; `--native-status` queries its actual kernel peer channel. `--version` prints QA build identity. The native shell displays the helper's one-use pairing code and confines navigation to that helper's exact loopback origin; it does not automatically approve or give browser tickets native authority. Quit stops only its owned helper.

Each exact source build uses its own private `~/.ynx-network-qa/qa-<identity>/` directory. Existing product directories and other versions are preserved. No independent chain trust context is bundled or inferred. The original offline proof tool is included under `Contents/Helpers`.

For isolated QA, `YNX_NETWORK_QA_DIRECTORY` may select a different QA root. It must already exist, be owned by the current user and have exact 0700 permissions; each build still uses its own `qa-<identity>` subdirectory. The launcher resolves this root with POSIX `realpath` before enforcing the IPC path bound. This task-specific setting never changes `HOME`, Foundation's user directory or profile contents, and cannot select an executable. With no setting, the normal App uses the real user's `~/.ynx-network-qa` as before.

Use **Configure independent proof materials…** in the native App to choose the original CORE public transaction trust context. Enter its exact 64-hex SHA256 obtained through an independent trusted channel. The field starts empty; the App never calculates a digest to fill or recommend this independent input. Do not select keys, account data or credentials. A matching digest only binds the selected public bytes: original context parsing, source authority and proof mathematics remain with the existing helper and original CORE executable. Missing original Source remains RPC_ONLY; configuration grants no verification, Wallet approval, funds or node administration.

Canceling either dialog or entering a mismatched digest preserves the existing configuration and running session. Apply validates the candidate, stops only this App's owned helper, waits for its actual exit, saves the profile and starts a new helper with a fresh one-use code. Browser tickets are not restored. Existing receipts and outboxes remain in the same version directory and receipt readback remains historical with `authority:false`.

Headless uses the same profile. With this QA version stopped:

```sh
./START.command --configure-proof-context /absolute/original-context.json --context-sha256 INDEPENDENT_64HEX
./START.command --proof-profile
./START.command --headless
```

The local profile contains only build/owner identity, original public context path and the independently entered digest. It cannot select a shell, executable or command; only the packaged helper and packaged original CORE verifier are used. Successful previous profiles are preserved. Unsafe permissions, damaged or foreign profiles, session-time replacement, and changed context bytes fail closed without deleting the original files or history. An active version session holds a kernel lock so a separate CLI cannot reconfigure it. This protects local QA process ownership; it does not turn same-user filesystem access into a cryptographic authority boundary.

A missing or changed public context stops helper startup. The native configuration entry remains available to explicitly choose new original material and enter its independent digest; the previous profile is archived and the changed original file is preserved. A damaged or foreign local profile cannot be overwritten through this recovery path.

`source-manifest.json` records HEAD, source state, exact source/embed hashes, compiler identity, executable SHA256, actual service version and observed signatures. QA build, functional process acceptance, GUI, install, publisher signing and public release are separate gates.

When the original CORE owner supplies a matching local QA verifier, the builder
accepts `--original-verifier /absolute/original-tool`,
`--original-verifier-sha256 INDEPENDENT_64HEX` and
`--original-verifier-source ORIGINAL_40HEX` together. It captures a regular,
current-user, non-writable-by-others executable without following a final
symlink, checks the independently delivered digest, and binds its bytes and
supplier source declaration into the build identity and manifest. The bundle
still uses one fixed internal tool; HTTP, proof profiles and GUI inputs cannot
select an executable. This QA intake is separate from publisher signing and
Source qualification. Original proof/context formats, clock and network gates
remain the original tool's responsibility.

The bundle's minimum macOS version is read from all packaged executable load
commands and recorded in `qa-build.json` and `Info.plist`. A supplied verifier
can require a newer macOS than the native launcher's baseline; that artifact
does not establish compatibility with earlier systems. Building on a host
older than the effective deployment target is refused.
