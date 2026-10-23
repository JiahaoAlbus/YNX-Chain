# Complete segmented artifact recovery, 2026-10-24

Code `766f9afcd1f0ead1bd6b5162f1e239bb9aae6a24`, hard total deadline follow-up `adb4e5f107b4c0d10654ac244f17806a8d8f079c` extends the original exact206 diagnostic recovery to the native-stream small tier. It starts no node and sends no transaction. The original fixed17-member/128KiB central-directory reader remains an older diagnostic tool, not a valid reader for growing segmented evidence.

## Implemented path

`scripts/loadtest/native-stream-artifact.py` reads immutable64KiB range blocks, incrementally parses the original central directory and supported ZIP64 fields, and processes each selected public member without retaining a lifetime member/index list. Fixed selection bitmaps catch duplicate intent/terminal names. It checks local names/methods against central headers, CRC/decoded sizes, complete deflate/data descriptors, and computes per-member SHA256 before publishing exclusive/fsynced output. Existing output is verified against original decompressed range bytes, including SHA256, before resume accepts it. Corrupt/uncertain partials are retained and never silently rebuilt or overwritten.

The original exact206/content-range protocol is retained;200 responses are rejected before body reading. The cache is bound to original artifact id/run/head/size and each block hash, with one consistent ETag. Download URLs and credentials are never persisted. The command retains the original SIGALRM hard60s total recovery window, including blocked reads, no automatic retry, and preserves original cache for a later read-only resume. Reported GitHub ZIP digest is labelled unverified; no whole-ZIP digest is computed.

The explicit read-only recovery limits are512MiB archive metadata size,8MiB central directory,20000entries,16MiB decoded per member,96MiB selected decoded data and128MiB retained range cache. These are separate from the original45+15s/RSS1GiB/private256MiB node case budgets. Hitting a recovery limit refuses completion; it does not select a larger profile.

`unit` selection recovers only the original public Go fixture. `network` selection is the fixed original single-case layout: receipts, manifest/initial inputs/plan/report, all intent and terminal segments and original process logs. Sender and node private keys are neither selected nor expanded. The original workflow now excludes ephemeral sender, Comet validator and node private key files from the uploaded case/pair artifact while retaining them in its isolated fixture.

Recovered network validation uses captured files with the original runtime paths treated only as identity data. It reuses the exact small-tier validator and compares its complete readback with the original controller receipt. This remains separate from original CI terminal/fsync/native resource qualification; a download, original receipt or helper success alone never sets networkQualified.

## Actual original artifact readback

Original controller/source CI40020611434, exact `c232425848bbbb14f3bc3a0f4d0debfc00358f03`, completed SUCCESS/attempt1. The original log is606908bytes, SHA256 `7be4086bfd628a679575590f2829a855bc41fe55e8b96c480806d8478126624b`; controller87 tests, reader17 tests and all17 source gates actually ran, and the scheduled network step was SKIPPED.

The new CLI recovered original public artifact12530985827 using three exact HTTP range blocks. All106 original public members were restored,202167 decoded bytes. This unit artifact contains only public files, so those three blocks cover all166219 archive bytes; there was no full-ZIP HTTP response or computed whole-ZIP hash. Complete original intent/terminal/latest-slot and six Go histogram readback succeeds for102 signed application transactions. Quorum remains synthetic unit gates.

The stream member identity SHA256 is `dcd577ef3a6d8b039c0f7d8be88e488f548ec92e3b268a387dc60aa140803b5c`, exactly matching the original CI log. The separate ZIP-selected member descriptor SHA256 is `ed4731f101ed662ec65ecd7dc668fcf933b2ec7febe7e864c7c3fd6a09313b8b`. These manifests use different ordering/scope and neither is a whole-ZIP digest. A second read-only recovery reused the same original blocks and members, fetched0new range bytes, and produced identical complete readback and selected-member manifest.

The16 local source tests passed1.162s; the final hard-deadline blocking-interrupt delta passed1test in0.043s. They cover an1800member/>128KiB central directory, original Go public byte/latency round-trip, ZIP64/local descriptors, bad CRC/local name, duplicates/path escape/symlinks, public selection, original-SHA resume, exact206, ETag substitution, wrong cache identity, deadline and incomplete cache refusal. Synthetic HTTP/ZIP counterexamples are not measured native resource admission. The original CI now runs this new group with its mandatory original Go public fixture. Final source gate19cases passed0fail0skip in12.563s; the hard-deadline CLI also completed a fresh cached readback of the original artifact with0new range bytes and identical complete evidence.

[Original controller CI proof](evidence/native-stream-small-controller-normal-ci-40020611434-actual.json), [recovery hashes and scope](evidence/native-stream-artifact-recovery-local-20261024-actual.json), [prepared8192-input workflow tuple, not executed](evidence/native-stream-small-tier-prepared-not-executed-20261024.json).

## Next execution gate

Normal CI for this new exact source must succeed before a new Root once grant binds the immutable source/ref and explicit single-case workflow tuple. The original launcher still verifies actual Linux ELF/vcs/source, native memory/disk capacity, original roles and active/cleanup budgets before node activation. Previous consumed grants are not reusable. No new four-node case,8192 network finals, matched improvement,600second load or sustained1000TPS is established here.
