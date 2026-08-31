# Finance Linux amd64 candidate — source-only artifact

Date: 2026-08-31

## Build identity

- Source commit: `ec14d0845ca7f3989c8267878ed04628e4204875`
- Source tree: `b3d3211b12074d3ccd8a832b59be13447f5a07c3`
- Target: Linux amd64, static ELF x86-64
- Build command: `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false`
- Embedded commit/release: `ec14d0845ca7f3989c8267878ed04628e4204875` / `ynx-finance-ec14d0845ca7`

## Immutable candidate

- Archive: `/tmp/ynx-finance-ec14d084-linux-amd64-candidate.tar.gz`
- Archive bytes: 3,942,975
- Archive SHA-256:
  `984e55b11a350ec4059f8e921b473dd9ad93d632427927673e73214e5664bf67`
- Binary bytes: 8,589,496
- Binary SHA-256:
  `e08d52bccdce6be52d52e004c812acbf58849802d94a2a65a5a481d68f570741`
- Payload manifest bytes: 678
- Payload manifest SHA-256:
  `cf997ad163df886df4f3a651a51bb77776e02cc213e76f7fa71017da8790ee7c`

`SHA256SUMS` intentionally excludes itself and verifies the binary plus seven
Web assets.  A first self-referential temporary manifest was detected before
freezing and replaced; it is not evidence for this candidate.

## Payload hashes

```text
c76feecc460956ff7b654f6ae574fce8798130244f40e52a9d4b188f090246dc  web/app.js
c367db5ec87c9194225484a76021540665ba885787b8f37cde490eb26c884343  web/index.html
3f7bec35f54aad6a095151e9d4d553e7ea10cbbbcc9e16f0f3fe7abd242b6d05  web/manifest.webmanifest
e19b7b266c14b181a4d88b10c6e1975398bdafb77660272f37ba22b48fc18c70  web/read-sources.js
332769483e5eda65afde9cd67bb332f5024186a9325e10d6cb6ab5d25a56b2a6  web/styles.css
4b613021346bf3eff46bda5cc5df2122443e12f60a299de64bf156bdf89e287b  web/wallet-auth.js
df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d  web/ynx-logo.png
e08d52bccdce6be52d52e004c812acbf58849802d94a2a65a5a481d68f570741  ynx-finance
```

## Boundary

This is an offline candidate only.  It is not staged, deployed, signed, or
public.  A future Finance-only lease must bind a PostgreSQL configuration and
fresh production/rollback state before any remote write or browser proof.
