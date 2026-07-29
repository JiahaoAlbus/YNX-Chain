# YNX 17 Blockers

Updated: 2026-07-29T02:56:46Z

## E17-B001 — Direct shared-Testnet owner attestations absent

- Owner: 01 Chain Core, 12 Explorer, 13 Monitor, 26 Data Fabric, and 29 Integration
- Reason: YNX 17 cannot self-assert another owner's observed source commit, accepted evidence digest, validator identity, or shared-Testnet outcome.
- Original evidence: `release/operator-inputs.request.json` and `product-release.json` retain all shared-Testnet acceptance booleans as false.
- Preparation completed: versioned schema, validator, hardened 0600 atomic store, audit reconciliation, idempotent replay, source-rebinding rejection, restore drill, CLI, and test vectors are implemented and passing.
- Why it cannot be solved autonomously: the missing facts must originate from the named owners' real environments and signatures.
- Minimum external input: one valid signed owner-evidence document for each required owner, bound to its actual consumer source commit and observed Economics evidence digest.
- Resume condition: all five evidence documents validate without replay, rebinding, time, signature, or schema errors.
- First action after input: run the existing acceptance CLI, persist verified summaries, rerun `make economics-shared-testnet-acceptance-check`, and update release truth only from the resulting evidence.

## E17-B002 — Production signing, hosting, and public deployment authority absent

- Owner: 30 Security/Release, 29 Integration, 28 Website, and the authorized production operator
- Reason: the current five-binary package is an unsigned, unhosted local candidate; no authenticated production signer, hosted download, Vercel deployment, or public runtime proof is attached.
- Original evidence: `product-release.json`, `public-product-metadata.json`, and `release/economics-testnet-cli-artifact.json` explicitly preserve production and public states as false.
- Preparation completed: reproducible double build, SHA-256, transient install/cold-start/removal evidence, local SBOM/provenance material, release boundary, public metadata, and Website handoff inputs are available.
- Why it cannot be solved autonomously: production signing keys, release publication authority, central integration acceptance, and deployment credentials are outside YNX 17 ownership.
- Minimum external input: approved central source commit, authenticated production signature/provenance, hosted artifact URL, and verified deployment evidence for `https://ynxweb4.com/ynxt` and `https://ynxweb4.com/economics`.
- Resume condition: signatures, checksums, source commits, hosted bytes, and public routes reconcile to one approved release.
- First action after input: verify every signature and digest, rerun release/supply-chain gates, then update release and public metadata without promoting any unsupported state.

## Not classified as external blockers

- GitHub API TLS handshake timeouts observed during recovery were intermittent execution-infrastructure errors and succeeded on retry.
- Historical CI failures were autonomous engineering defects and have been repaired; run `30417960548` is successful.
