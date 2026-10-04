# Card backend packaging

Build from the exact owner checkpoint after its locked dependencies are installed:

```sh
node scripts/build-backend.mjs --output-dir=/absolute/fresh/card-backend
node --test scripts/build-backend.test.mjs
```

The output preserves `server/main.cjs` and the original `vendor` registry path.
Keep these paths together. `backend-files.json` binds the source commit, lockfile,
runtime used to build, file sizes and SHA-256 values. Existing output directories
are refused, not removed or overwritten.

This is not a standalone binary. Install the original Card lockfile dependencies
in the runtime root before executing `node server/main.cjs`. The packaging test
uses the existing locked installation in an isolated disposable directory; it
does not prove a new clean install or a production deployment.

Do not use the previous ESM bundle: its registry loader requires `__dirname`.
Compilation alone missed that startup failure. The actual launch gate requires
the original protected refusal `CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE`, not
module-resolution or registry-path errors. That refusal proves the packaging
reaches the source fence, not that private Card services are available.

The original Host composer must still provide its genuine construction-time
Current/role/custody source and authenticated approval/recovery transport. No
environment boolean, no-op callback, injected test principal or synthetic receipt
may replace them. This packaging does not grant permissions, activate a card,
sign, send YNXT, credit a ledger or deploy the public alias. Real payments remain
disabled.
