# Finance mobile bundle gate — 2026-08-31

The Finance mobile source completed its local `npm run check` gate:
TypeScript typecheck, seven client tests, accepted endpoint-manifest verification,
and Expo Android/iOS export. The endpoint manifest SHA-256 was
`3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5`.

## Exported bundle receipts

| Output | SHA-256 |
| --- | --- |
| `android/index-6f702e71c5f471596fe7a3bb11ef7012.hbc` | `90e41d5eb8cdf57550ce64c95d7bef52efc24a7ee389ef632236a253fa2eb251` |
| `ios/index-74c09ec9a669076a0035faa144857ca1.hbc` | `b61fdfe62aa7444a0b4d8baaa49322f75df5e6725fcf4aae78148bb08e4443e8` |
| `metadata.json` | `a9cf241e12c00e4cc958396dd18bd4ca0896f88d2b3518a5619282d5584a2f91` |

## Truth boundary

Expo export emits JavaScript bundles only. It is **not** an Android APK/AAB or
an iOS installable application. `installedLocal`, `downloadHosted`, signing,
cold-start, second-launch, network-recovery, store release, and public runtime
claims all remain false until a separately authorized native build, signing,
install, and visible-device evidence path exists.
