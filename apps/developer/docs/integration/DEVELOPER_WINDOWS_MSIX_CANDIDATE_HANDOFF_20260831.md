# Developer Windows MSIX candidate handoff — 2026-08-31

This is an internal candidate handoff, not a website publication instruction.

- Source: `fa73d751ac72f8572fb2dcf364ebf2b649470f72`
- Tree: `254134eb87c34faa7e1b53ebce32f102f638199b`
- CI: [run 33372831985](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/33372831985), job `99427582934`, success.
- MSIX: `ynx-developer-testnet-preview-windows-x64-test-signed.msix`
- MSIX bytes: `71572168`
- MSIX SHA-256: `0abb87beeb603ff177e25bb9504d359684e796c3596879df3dcfb719440d6dde`
- CI artifact ZIP bytes: `143527942`
- CI artifact ZIP SHA-256: `3ad468d485031b143a7a0caff7013873dac62d611b7a1dad0006b56370063748`
- SBOM SHA-256: `c816f62e70d215920b5a8fe4089ec94b9d443545bf7150f68c35ce067fa1dd93`

The Windows runner performed portable extraction, embedded-provenance/resource
checks, real bounded remote C++ compilation, portable cold and second launch,
then `Add-AppxPackage` validation of the MSIX, installed-payload cold and second
launch, and uninstall. Its signing class is `test-self-signed-not-production`.

It is **not** an official download: the Actions artifact is time-bounded, its
outer ZIP has not been independently downloaded and recomputed from this host,
and there is no immutable official-domain URL, production Authenticode signature,
store release, or public browser/installed-runtime evidence. Do not restore or
promote any ZIP as a desktop installer. The next Website/Integration action needs
immutable storage, exact external HTTPS bytes/SHA-256 readback, and a separate
rollback-bound publication lease.
