# QR encoded-image limits before native decoding

## Actual gap and scoped correction

Inherited clean baseline: commit `476c72bfc0af958c96bf7bf9aaed731471f0b8e9`, tree `9d3825dfac26dd76f09dc9a91473f2b52bb07fbe`. Existing QR input enforced 10 MB encoded bytes, 4096 pixels per side and 16 Mi pixels, but read the dimensions only after `nativeImage.createFromBuffer`. The allocation boundary therefore came before the intended pixel-size check. This is a demonstrated ordering gap, not a claim that a real resource-exhaustion attack was performed.

New metadata preflight in `src/qr-image-bounds.mjs` runs before `createImage` for all three actual receiving, invoice and WalletConnect consumers. It retains the original PNG/JPEG/WebP allowlist and all original limits, rejects mismatched MIME/container signatures, bounds structural reads to the encoded input, and checks dimensions without pixel allocation or decompression. It covers PNG IHDR and APNG fcTL, JPEG SOF with bounded marker traversal, and WebP VP8X/VP8L/VP8 plus animated frame/nested image headers. The original post-decode dimensions are still checked and must match the bounded container. Alpha composition, reference parsing and protected business/lifecycle logic are unchanged.

The web-search workflow directed the format checks to primary specifications: [PNG IHDR/frame definitions](https://www.w3.org/TR/png-3/), [WebP RIFF/extended frame definitions](https://developers.google.com/speed/webp/docs/riff_container), [WebP lossless dimensions](https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification), and the pinned [libjpeg-turbo 3.1.3 SOF parser](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/3.1.3/src/jdmarker.c). No new dependency or native codec was installed.

## Current controlled verification

QA directory: `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`, retaining its admitted SDK955 dependency closure. No existing account/profile/GUI, App.tsx, startup branding, versions, shared SDK/Auth/registry, Web source or Host was changed.

- New tests against unchanged production baseline: 2 pass / 3 fail out of 5, exit 1; `qr-image-bounds-before-v2.log`, SHA256 `d40ef512996833c383009aa7d885dc3fb5e05d4de6919560bcea9f87b6eb44a4`. A spy confirms oversized header input reaches the old native image boundary before rejection, without actually allocating large images. Initial preparation lacked the QA helpers directory; its separate missing-module log is retained and is not a product failure.
- Initial corrected metadata targets: 5/5, exit 0; `qr-image-bounds-targeted.log`, SHA256 `c3f6386f8611a099a994b2e71f975e2a525fa3cbb5069ef2029a661fa19a2660`.
- Existing/new real pixel and authority/refusal integration targets: 81/81, exit 0; `qr-image-bounds-integration.log`, SHA256 `57fc94aa153e697921e881e1b64d11821dbf6cc9439d2ed36dcf96ed7c2a1de3`.
- Final expanded targets: 11/11, exit 0; `qr-image-bounds-final-targeted.log`, SHA256 `57bd5aa644ef5aa5c15fd52fed4c429d07bf37f1bd8bb9c299a8e8886fde8232`.
- Actual macOS Electron 42.8 PNG/JPEG native codec and original protocol refusals: 19/19, exit 0; `qr-image-bounds-native-codec.log`, SHA256 `bfb5406b1f2e253308e6c1d8488bb8f11c879ce6145fad14fa5b302179877b7b`. These are the same deterministically generated cases as the earlier alpha repair, freshly rerun against the preflight; the identical log hash is expected.
- Final full Desktop regression: 685/685, no failures/skips/cancellations, exit 0; `qr-image-bounds-final-regression.log`, SHA256 `8e6ead924cf6d0ff84698f31d57e3d82c4a8b0da85831aabd4342fb8e88de8e9`.

Five prior tests now supply explicit bounded PNG metadata fixtures instead of one-byte/arbitrary containers at the injected image boundary. Their actual pixel conversion, QR parsing, protocol assertions, field contents and lifecycle tests are unchanged. Helpers clearly label metadata-only fixtures; they are not asserted to be valid encoded images. The real native codec script continues to use complete PNG/JPEG bytes.

The metadata parser is not a replacement PNG/JPEG/WebP decoder, CRC/compressed-image validator, comprehensive codec sandbox, or a proof that every possible metadata/decompression resource hazard is eliminated. WebP/APNG animated-header tests are metadata/controlled boundary checks, not actual OS codec or rendered animation acceptance. Windows/Linux native codecs remain untested.

Native App remains SHA256 `c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`; its prior 935/935 result is inherited, not rerun. Release-content check passes 100 Native runtime/config/metadata files; `git diff --check` passes.

## Unchanged final product gates

CUA current-state inventory again returned Mac locked and normal automatic unlock unsuccessful; no real UI capture, device/biometric/account/installed flow or security bypass was performed. A's observed current coordination state is source review/admission work, not fresh signed Wallet packages or installed acceptance. Exact new Wallet protected tuple/OS/business ports, complete cross-surface integration and sole-A forward versions/signing/website install/user business flows remain unverified. No real external QR input or MONSTER acceptance was run. Overall goal stays active.
