# Retained original PQ performance client: byte reissue only

This is a transport recovery lane. It verifies the immutable retained original ZIP, original three public members, original SOURCE and Go BuildInfo; it never builds, runs or activates the Linux client. Original artifact12609705118/run40220335526 remains unavailable; this lane does not claim to restore the old URL.

The source manifest pins original source70e7e450997a0ae77dbad5a8be3682f482c6ddd8/tree4866cc3924c060eb6a29939915d39b1c5c625607 and producerda3060e150e2bd0f5695d67a76f3b30fafd1c696. The new workflow commit/run/artifact is publisher provenance only, recorded separately; SOURCE.json is never regenerated.

## Entry and sole publication owner

- The exact branch `codex/pq-client-retained-reissue-20261107` triggers only the16 pure archive controls and retained-byte readback. It uploads no artifact.
- After that fixed commit and successful pure CI are supplied to the unique V5 Root, **original A** alone selects the reviewed commit and normally creates/pushes the new lightweight tag `ynx-pq-client-retained-reissue-20261107`. No force, tag replacement or workflow_dispatch is provided.
- That exact tag alone enables official pinned actions/upload-artifact. Its primary artifact contains only `SOURCE.json`, `go-build-info.txt`, `ynx-consensus-perf-client`; verification/new-publisher records use another separately named artifact.
- Original A downloads the new primary artifact through normal GitHub API tooling and retains the outer ZIP. The Root delivery worker independently compares CRC, strict3 and all original member bytes. No second public download is needed.

The tag is not created or pushed by the delivery worker. Normal Git/CI publication does not authorize a binary execution, node, pressure window, keys, signing, production upgrade or a fallback to an expired artifact.

## Local read-only/content commands

```sh
python3 -I -B scripts/retained-client-reissue/test_reissue.py
python3 -I -B scripts/retained-client-reissue/reissue.py verify --archive scripts/retained-client-reissue/carrier/client.zip
python3 -I -B scripts/retained-client-reissue/reissue.py extract --archive scripts/retained-client-reissue/carrier/client.zip --output <new-quarantine-directory> --receipt <new-receipt.json>
```

For the new official artifact's different ZIP container, add `--reissued`; this only changes the outer-ZIP pin requirement. Names, duplicate/path/regular/encryption/compression/size limits, CRC, complete member SHA, original SOURCE/BuildInfo and Linux-amd64 ELF identity remain fixed. O_EXCL extraction creates readonly regular files in a new directory, without using extractall. Existing or partial output/receipt is never deleted or reused. A failure retains partial data and its first cause.

Python hashing/decompression is single threaded. On Linux the verifier/control process additionally fixes one available CPU and enforces512MiB address-space/60CPU-second limits; on macOS the caller records actual RSS and the single-process execution rather than claiming an unavailable affinity API. No Go/CGO/Rust/compiler/dependency install/private-key operation is present.
