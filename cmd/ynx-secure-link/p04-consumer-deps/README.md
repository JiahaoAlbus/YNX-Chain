# Original P04 PUBLIC consumer CI inputs

These exact source-only test dependencies are relocatable copies. They do not provide Root, Source, DEVICE/session or production receiver admission. No supplier binary, key, cache or runtime package is staged.

* P04 R17 single-consume handoff is 4346 bytes with SHA256 `3fe2fa797d73edae6bf34e47010a6b02ebd7737b479373415a83712cfb3d71ca`. Its archive is 2372254 bytes with SHA256 `6f7306406beed181403fb4178e73a2bef06a8fba0c839b3cfd1e7ae0ace8bc76`. The archive contains 446 source leaves and nine provenance members. Relative to R16, P04 changed only the principal test, now 27538 bytes with SHA256 `bf53776fd915800766b6a58626840733e4d1acffb6de06037b71e0422586fd0e`.
* In original run 42456926898 at `793c175b`, four tops passed and PrincipalFactory stopped at `unexpected replay 1` before the five field controls. The P04 successor asserts one SQL consumption and the same attempt, child, nonce, receipt and row across clone rejection, revocation, restoration and cleanup. The new execution still requires all five tops and seven subtests.
* Original PUBLIC SDK/vector H:3762 /876cabce7fe0bd4309fa8388ec2cab8d0c6520a4c8c610e2310117bb61a92602. Bundle:1069065 /7a418c7c8aacfa539760df7a3e3f1e4ee11455eef97504ace07257a9c38d132a. It contains280 SDK leaves, the original vector and SDK manifest. This is the original PUBLIC Source seam, not production SDK462 or Root approval. The archived Mac Node is deliberately absent. Runtime uses the actual original CI Node24 executable, fresh SHA and private exact copy.
* Comet original source repo commit63ba175ec3725845536963daca5c8b79418187ad, repository treecfa69e0246f6cc87fb7d87a947f5f4de38650c8e, module tree47d7cfeee7cd178cb897eda57a4674677fac7e67. Only its two unchanged descriptors are needed by the candidate local replace. Static traversal of the complete consumer package (including tests and platform leaves) has no Comet Go import. A new Comet import fails closed and requires an explicit new source graph; there is no older LINK fork fallback.

ORIGINAL.json maps every immutable supplier asset to a relative local file plus original bytes/SHA/path provenance. Original absolute supplier paths are metadata, never runtime lookup fallbacks. Every tar header/checksum, bounded PAX record and canonical member is parsed before staging; symlinks, hardlinks, special entries, traversal, duplicate paths, conflicting file/directories, extra/missing members and byte drift fail. Source descriptors are preserved; no GoFiles subset or default-stub exclusion can count as consumer execution.

## Original LINK S3 hook

    node cmd/ynx-secure-link/p04-finite-get-consumer-ci.mjs

No arguments. Required additional environment:

    YNX_LINK_P04_CONSUMER_EVIDENCE=$RUNNER_TEMP/<fresh-evidence-name>
    YNX_LINK_P04_CONSUMER_PRIVATE=$HOME/<fresh-private-name>

The private root must have an existing canonical parent whose complete ancestor chain is owned by root/current UID and has no group/other write bits. The driver creates only its own new0700 child and never chmods shared ancestors. The PUBLIC SDK, actual Node copy, temporary generated certs, owned-R5 release directory and Go temp files remain inside this private root. Public evidence must be separate. Do not use /tmp as the protected root or weaken the original verifierDirectory guard.

Reuse original S3 OPENSSL_PREFIX, PKG_CONFIG_PATH/LIBDIR, GOCACHE, Go1.26.10 and Node24. The selected CLI and linked OpenSSL must both be3.6.4. The driver sets CGO1/GOMAXPROCS2/GOMEMLIMIT1536MiB/GOWORKoff/GOTOOLCHAINlocal, builds no archive and starts no service. Whole package go test has unchanged150s test timeout and210s bounded outer compile+test command; no local Go run estimates are represented as measured runtime. Additional evidence is source before/after, raw stdout/stderr, command exit/signal, actual Node identity and strict5top+7sub RUN/PASS/packagePASS. Missing/duplicate/skip/fail/zero-hit is fatal. Normal runtime/source/deployment admission remains false even after a PUBLIC functional pass.

## Lightweight controls

    YNX_LINK_P04_CONSUMER_DRIVER_TEST_ARTIFACTS=<explicit-external-or-runner-private-root> node --test cmd/ynx-secure-link/p04-finite-get-consumer-ci.test.mjs

The metadata controls check the pinned source and archive members and the required RUN/PASS frames. Runtime qualification remains pending the original LINK S3 job.
