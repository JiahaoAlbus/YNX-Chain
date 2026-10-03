# Local QR image codec and transparent-background repair

## Actual failure and scoped production change

Inherited baseline: Native/owned commit `54253c64ab178d0cc8842421ed7ae9f95e018068`, tree `51dcf96c31808fe8aae440d60c8a4c77072df3cb`. The checkout was clean before this work. No Web, shared SDK/Auth, registry, Host, installer or account/profile source was changed.

Earlier QR tests generated real QR modules but injected pixel containers instead of passing encoded images through Electron's native codec. The new `scripts/native-image-qr-check.mjs` runs Electron 42.8.0 on macOS with a fresh isolated temporary profile and no BrowserWindow or Wallet main entry. It generates controlled public-reference PNGs with the existing `qrcode` dependency, passes their bytes through real `nativeImage.createFromBuffer`, and then uses all three production QR consumers with real `jsQR`.

Baseline actual PNG check: 9 pass, 3 fail out of 12. Black QR modules on a fully transparent light background failed for receiving, invoice and WalletConnect input with `QR_DECODE_FAILED`; opaque and original blue variants passed. The transparent image's actual corner bitmap was `[0,0,0,0]`. Earlier blue-only baseline passed all 9 and is retained; it did not prove the black/transparent case.

The pinned [Electron 42.8.0 implementation](https://github.com/electron/electron/blob/v42.8.0/shell/common/api/electron_api_native_image.cc#L254-L264) requests premultiplied N32 bitmap pixels. The [official nativeImage documentation](https://www.electronjs.org/docs/latest/api/native-image) also distinguishes encoded PNG/JPEG from raw platform-dependent bitmap data. Combined with actual native pixel observations, this supports retaining the existing BGRA adapter and compositing premultiplied RGB onto white before calling jsQR, which does not interpret alpha. Each channel becomes `premultipliedChannel + 255 - alpha`, and output alpha becomes 255. Original opaque RGB bytes stay unchanged; original bitmap bytes are not mutated. No additional decoder, dependency, upload, URL opening, pairing, signing or payment route is added.

Production module SHA256: `e9d6c2d6c3597dfd0448f21ec94b46e78aa9058ebb51655ff933b203923013ba`.

## Final current evidence

QA directory: `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`, retaining its previously admitted SDK955 closure. Production module, new Node test and native-codec script were cmp-equal to owned source before delivery.

| Check | Result | Log SHA256 |
| --- | --- | --- |
| Original native PNG black-transparent reproduction | 9 pass / 3 fail; original failure retained | `6896350b52e584ff3a9137ab89151da54d3370ff473ab3b266776f9b9d027187` |
| Initial corrected native PNG check | 12/12, exit 0 | `97580bdc6938789077d815a605e237f832350152a797f043d12cee98c8c5fdfc` |
| Final encoded native PNG/JPEG check | 19/19, Electron 42.8.0 / darwin, exit 0 | `bfb5406b1f2e253308e6c1d8488bb8f11c879ce6145fad14fa5b302179877b7b` |
| New Node pixel/protocol regression | 4/4, exit 0 | `707e0da770852edb8e07cd5b3caf9f968d1bfab3429d0bd3ce1e1abe716e37c5` |
| Complete Desktop regression | 674/674, no failures/skips/cancellations, exit 0 | `9b1bf143fff5d6f2c0922e9f95e5589ab0c2f53dbb3eccd8d136829d003e342e` |

Log filenames respectively: `native-image-qr-before-black.log`, `native-image-qr-after.log`, `native-image-qr-final-v2.log`, `qr-alpha-targeted.log`, `qr-alpha-full-regression.log`. An intermediate final QA script incorrectly called `app.getAllWindows`, yielding a script API error; its log `native-image-qr-final.log` SHA256 `979a3ba8ff64f22b1b7a51e0f55acae81e61b861a1161d27bfcf174ceaa67c83` is preserved. The final script correctly checks `BrowserWindow.getAllWindows`; no window was created in any run.

The final native check covers opaque blue PNG, black transparent PNG, blue transparent PNG, blue translucent PNG and JPEG for each of the three production consumers (15 positive paths). Four additional actual PNG cases preserve original refusals for wrong network, receiving amount injection, invoice action injection and non-WalletConnect URL. Unit tests independently check exact opaque/partial/transparent channel bytes and unchanged pixel storage, all three real QR module paths and original protocol refusals.

Native App remains SHA256 `c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`; its prior 935/935 result is inherited, not rerun this turn. Previously protected running GUI/profile processes were not focused, restarted, changed or terminated. New isolated headless QA processes exited normally.

## Product and release boundaries

This is real Electron native image decoding of synthetically generated encoded files, not externally supplied QR input, camera hardware, file-picker interaction, installed Wallet UX, account authentication, or business payment acceptance. Windows/Linux image codecs are not run. WebP codec support is not newly claimed. No real private account, key, PIN, signing, network transfer or Product Session was involved. MONSTER was not run.

Read-only source routing confirms `apps/wallet-web` is a separate PWA/browser-extension custody surface, not Expo Web: the PWA holds no keys and connects to installed Wallet, while the extension retains its own password-encrypted account/journal. This chat's write lease is only `apps/wallet/**` and `apps/wallet-desktop/**`; no Web change or parity acceptance is claimed. Root/A must own the complete cross-surface graph, exact new Wallet business/OS tuple, final forward versions, signing and website installation/user engineering flows. Overall goal remains active.
