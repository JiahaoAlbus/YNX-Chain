# Native Paper costs: exact local runtime freeze

Source `9b4f10b0b7d89e993115b63578549a6cf14329b3`; tree `368e1501b305b8c1839666c0f126c7e4ef92bf11`; branch `codex/quant-paper-microsite-composition-20261004`. This evidence-only commit does not alter that frozen runtime.

- Archive `/tmp/ynx-quant-composed-9b4f10b0b-linux-amd64.tar.gz`: 3914822 bytes; SHA256 `19ba0d37b49faf55869568922329b33da09026dd82724e3f88e9f6a2014d9548`.
- Release `ynx-quant-lab-9b4f10b0b7d8`; Linux amd64 `ynx-quantd`: 8302776 bytes; SHA256 `3aa8b1de69ebeb01260e4c1f3f50cb059a97823b8b8c5dc2824b7cf3fa1e5725`.
- Manifest: 5580 bytes; SHA256 `720fa57cf477ba434f3f4217cd2de63b4fd37141e43f61396fab0d79c4ff05f7`.
- SHA256SUMS: 1267 bytes; SHA256 `d5450e7339c77ea2680f2a19039eb912979b628ceaa60e7e1c9fb1f515b080ea`.
- Owned consumer bundle: 435353 bytes; SHA256 `0199d3c91fc6422b3f2598aa661d17b5fdcca06e410a0acf25f97272c1fc4a45`.
- Index: 33245 bytes; SHA256 `03835d3aeaf3a92abf153e81ae52798a35efff867cf03f27d6b91f8fae802fc9`.

Packaging: `node apps/quant-lab/scripts/package-runtime-candidate.mjs --commit 9b4f10b0b7d89e993115b63578549a6cf14329b3 --output /tmp/ynx-quant-composed-9b4f10b0b-linux-amd64.tar.gz`; fourteen entries, eleven complete Web assets, exact clean source/inventory/SUMS and x86-64 ELF checks passed. Linux execution is NOT VERIFIED on this Mac. Archive is an engineering server candidate, not a desktop/mobile installer.

Packaged local Chrome: `node apps/quant-lab/tests/packaged-guest-browser.mjs /tmp/ynx-quant-composed-9b4f10b0b-linux-amd64.tar.gz 9b4f10b0b7d89e993115b63578549a6cf14329b3`; 320/390/1280px all eleven assets, pageErrors zero, non-GET zero, one tab, English and display preference restoration passed. Evidence `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-packaged-browser-kObSI5`.

Screenshots: 320px 73883 bytes SHA256 `ea41495c44b6c0d2074efc371fea6114dc39f98a03def86b9942d23ff6b2141f`; 390px 80354 bytes SHA256 `1daf16a83a7bf1aafe992b9fef6137bce262d0857a442da699515ba198200f53`; 1280px 140999 bytes SHA256 `0004aca91281c2b93b5c5ca132a02dbdc6b18cd5b42f2da1b47865de6a217b2c`.

Final Node: 315 total / 314 PASS / zero FAIL / one matching Hosted Wallet environment SKIP; 108479.403209ms. Go race: quantlab 9.871s, server 1.432s. Controlled native browser and cost controller eleven PASS, zero SKIP. Invalid current strategy hashes remain rejected; old-version test lineage was corrected to consume its current owner snapshot.

## Publication / rollback boundary

A remains the formal shared producer and Host publisher. No SSH/upload/UNKNOWN retry or production mutation. Public/installed/real approval/Product Session lifecycle/signature/Testnet/ComputerControl false. Formal publication must independently match current shared producer, data and rollback binary. Legacy typed-reader proof applies to legacy records only; it does not license rollback to an old pre-cost binary after versioned cost records have been persisted. Existing original-engine cost records and durable receipt layout are reused; no second state envelope is introduced.

## Next ownership split

Native research scheduling is still not authorized by the current explicit Paper purpose (which says no scheduling). Candidate registry has `quant:paper:workspace` but no dedicated research scheduling scope. Product-owned scheduling service/UI can reuse original `/v1/strategies/{id}/schedule` engine, but A must supply the canonical separate permission/approval binding before it becomes active. Do not widen an existing approval, borrow a browser-local tenant credential or infer real-capital scheduling authority. Other owned improvements remain autonomous; this shared permission gap does not suspend ordinary development.
