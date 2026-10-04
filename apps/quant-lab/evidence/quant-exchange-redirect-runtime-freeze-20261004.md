# Quant redirect-safe runtime candidate

Code source `f28a1560d5a6f25d77450adc20ef9cc39815e9b5`, tree `36eab3ff395e7f6e947d631fa55c34beebccdaec`, release `ynx-quant-lab-f28a1560d5a6`.

| Object | Bytes | SHA256 |
| --- | --- | --- |
| /tmp/ynx-quant-composed-f28a1560d-linux-amd64.tar.gz | 3938578 | 5dd8c29d7603aebcaf148637fae462fe293f2a4b1771ca19c7d8d2ae03e2d22c |
| ynx-quantd | 8331448 | c1266168f3026488c986c0c8aa2d4b50f6d648470b7f8bd01c17e324c2eba27a |
| BUNDLE_MANIFEST.json | 5580 | 9ffce73e628d40b96d6008501146d2ce187aa0e1bc2fc8d4fbcfa56278de8fef |
| SHA256SUMS | 1267 | a52005970bc1b2ac544d8e5250904be0726cf9ecbc3a0929716101d63589fba9 |

Built from clean exact Git source with original owner packager: Linux amd64 ELF, CGO=0, trimpath, BuildCommit exact. Fourteen entries: binary, all eleven original Web assets, inventory and sums. Web asset bytes unchanged from b60; existing original local packaged guest screenshots remain historical b60 evidence and are not relabeled as this binary's installed/public proof. No native installer claimed from this service tarball. Previous b60 and earlier archives are preserved.

Full Go race regression PASS 45.923s/1.442s; redirect-focused race PASS 2.128s. No production action, state/schema/auth scope change or account operation. The formal publisher must use matching source/binary/assets/state/rollback and run the read-only gate after publication:

```sh
node apps/quant-lab/scripts/verify-public-runtime.mjs /tmp/ynx-quant-composed-f28a1560d-linux-amd64.tar.gz f28a1560d5a6f25d77450adc20ef9cc39815e9b5
```

Expected public version route is `/api/version`, not root `/version`; `/api/health` must bind the same source. Gate also checks every canonical Web asset against inventory status/bytes/SHA. Current public old 664b observations are in `quant-public-runtime-binding-gate-20261004.md`; they are not candidate publication evidence. Public candidate, Linux execution/installation, real provider approval/callback, private session lifecycle, signatures, transactions and full product completion remain unverified. Host and UNKNOWN transport remain untouched.
