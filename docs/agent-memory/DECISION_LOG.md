# Decision Log

## 2026-07-29 — Preserve implementation and evidence commits separately

`e36832d5be0c498d8a2f27869f8d70fc112e9442` is the bounded staking metadata implementation candidate. `7b386fc4ea7be4d25bf9217f6242d6da17a6f6f9` binds CI, artifact, integration and handoff evidence. Recovery records identify both rather than rewriting history or creating a false self-referential source commit.

## 2026-07-29 — Do not promote accepted package states to a newer candidate

The accepted public package remains hosted and unsigned. The newer candidate remains not Website-accepted, not hosted and not production signed until direct owner evidence exists.

## 2026-07-29 — No broad merge from main

The product branch is materially behind and locally ahead of `origin/main`. Compatibility and merge order belong to YNX 29. YNX 18 will preserve its product commits and produce contracts, vectors and handoffs instead of silently merging or discarding concurrent work.

## 2026-07-29 — Treat duplicate canonical as a Website-owner defect

The authority route is public and the archive is valid, but two canonical elements are an SEO correctness defect. YNX 18 records the evidence and acceptance contract; YNX 28 owns rendering and deployment correction.

## 2026-07-29 — Keep staking disclosures non-activated

Metadata normalization does not activate staking, liquid staking, rewards, slashing or the Safety Module. Those remain gap/design disclosures unless the owning runtime and economic authorities provide accepted evidence.
