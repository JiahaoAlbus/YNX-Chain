The five-package notice supplement adds seven original files. It does not change
the vendor resource manifest, binaries, bridges, network readiness, or legal
clearance. The original coverage pin remains UNKNOWN57. The separately pinned
supplement is UNKNOWN52, with the Arti root license still UNKNOWN.

`notice_intake.py` is offline and takes the original pinned ledger, locked crate
cache, reviewed HTTPS intake receipts, and a **new** output directory. It verifies
the exact publisher commit and original notice bytes; it never fetches files or
overwrites the admitted supply. `priority-queue`'s LGPL/MPL files are read directly
from the checksum-verified 2.7.0 crate. The four other packages use original files
from their `.cargo_vcs_info.json` commit in the repository named in `Cargo.toml`.

Run only the new delta after the original verified supply and candidate material
artifacts have been supplied to the existing CI intake job:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_notice_intake_delta.py \
  "$ORIGINAL_TOR_SUPPLY" "$TOR_NOTICE_CANDIDATE" "$LOCKED_CRATE_CACHE"
```

The seven cases check the new material mapping, exact hashes, strict refusal,
old-supply separation, missing/mutated originals, wrong-commit receipts, and the
previously missed LGPL/MPL filenames. They do not rerun the original notice test
matrix. No remote CI execution is asserted by the local result.

For a complete candidate supply directory containing unchanged fixed vendor
bytes and the reviewed new ledger/materials, the strict consumer must still
return **3**, with root UNKNOWN and 52 unresolved dependencies:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/license_supply.py \
  "$CANDIDATE_TOR_SUPPLY" --require-complete
```

The actual intake's `NOTICE-INTAKE.json` supplies each original URL/archive member,
published commit, byte length, SHA256, and append recipe. Unknown source locators
remain explicit. A successful HTTPS fetch or notice-byte check does not authorize
formal release, privacy-route activation, or a legal conclusion.
