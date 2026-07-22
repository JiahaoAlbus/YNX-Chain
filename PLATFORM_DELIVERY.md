# Platform Delivery Decision

YNX Oracle is infrastructure and a public read/documentation product. Its
applicable deliverables are:

- Go server daemon and operational CLI flags.
- Versioned HTTP API and Go consumer SDK.
- Non-root Linux container definition.
- Responsive, installable Web/PWA at `/oracle`.

Native Android, iOS, macOS, and Windows applications are not separate product
requirements: they would duplicate a read-only Web console while expanding the
signing and store-release surface. Mobile and desktop users receive the PWA;
backend consumers use the API/SDK. There is no unsigned native build, production
signature, or app-store release, and none is claimed.

The container and public API remain uninstalled/unpublished until real provider
registry, signer custody, image scan, and deployment evidence exist.
