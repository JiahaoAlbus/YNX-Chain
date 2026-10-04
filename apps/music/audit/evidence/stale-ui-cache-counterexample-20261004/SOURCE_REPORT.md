# Media6288 / Music4ec Android library cache independent review

Disposition: **SOURCE_HOLD** for the complete bounded Android profile/download/cache/library-intent successor. One new P2 is confirmed in original production cache code; several intended transaction boundaries pass independently. No device, canonical authority or full Media/public admission is claimed.

## Immutable identity and custody

Delivery commit `6288eca4403564d6eaa035aaaa566ed8b1e5db92`, tree `792cea39ee378a0111557e793e08f7ed9ab49514`; runtime source commit `4ecbb75f0393d83b9a51b1e619a3b1e9fb19da7d`, tree `099537be3931e00b002af62c4d7dbb99b129180d`.
Frozen checkpoint SHA256 `7abc4c64004b8401c4106ed8b3355b3d1bea5ba3e7c6ac10e0f050c6a819b262` was read from exact Git, not mutable HEAD. Source archive 4,279,318 bytes SHA256 `b002f9ce8e5e0e1d817ffb8c55d184cab13348f8a92f1b66f2a6dee4886f520c`.
All 627 regular source archive members freshly match exact source Git bytes and modes. Tar checksums, safe paths, PAX byte lengths and duplicate/link/special-file rejection verified; no named directory entries are present. All 28 unique pinned source/candidate/inherited/evidence artifacts freshly match exact delivery Git bytes, sizes and SHA. APK, Apple candidates and inherited public readback are custody only, never executed or queried. Final source byte/mode verification passes for all 627. Custody SHA256 `905c9795981576da2a740cb7b36098aa80e8400d312eed413bf5d2f0cb18ae78`.

The initial verifier narrowed names to product directories and rejected legitimate `go.mod`; verify-first-scope-rejection.cjs preserves that reviewer inventory error. Final verification admits safe relative archive members only after exact frozen Git byte/mode verification; inherited non-owned dependencies/assets are custody, not new source admission. No source or fixture assertion was changed.

Exact six-file delta from source parent basis `65131f84c5c510f0de7fcee589e42abbf978c33c` through 0bb723c3 and 4ecbb75f is recorded in runtime-exact.diff. Full owned delta and direct caller/control-flow context were read:
- Android MainActivity.java, MusicStore.java and new MusicLibraryWriter.java.
- OriginalUploadCheck.java, android-upload-original-business-check.mjs and compile-android-upload-check.mjs.
- Original MusicApi.java, MusicUpload.java, MusicIO/ReadBoundary, ordinary local fixture types and original Go library handler/service behavior as necessary context.

No stopped SharedJS/e105/2a6 implementation or Node auth/Central source was read or executed. The changed owned test wrapper was read to establish its SDK/network dependency boundary; it was NOT_RUN. Archive assets outside this Android bounded scope remain custody only; 627 files do not constitute whole Music/Video/Creator source admission.

## P2 MEDIA6288-LIBRARY-STALE-CACHE: prepareLibrary replaces unrelated newer original state

Production location: `apps/music/android/app/src/main/java/com/ynxweb4/music/MusicStore.java:58-62`, particularly whole stale candidate construction at 59 and save at 62. Actual caller: MainActivity.java:87-92 (toggle copies Activity state). Concurrent original producer: MainActivity.java:209-216 upload worker, MusicUpload.java:12-19 stage, MusicStore.java:94-98 updateUpload. Normal completion loads Store into Activity only in uploadFinished, MainActivity.java:217.

A library edit is supposed to update favorites/queue/downloads and its durable intent while retaining other original cache fields. prepareLibrary instead deep-copies and saves the ENTIRE supplied Activity candidate. WRITE_LOCK serializes disk writes but does not merge a stale caller snapshot with latest persisted state.

Concrete normal path: Activity already holds an authenticated same-account UI snapshot. Upload is staged in a background worker; original stageUpload retains bytes and updateUpload durably records the uploadIntent before HTTP. Until uploadFinished publishes to the UI, Activity state still lacks that intent. Normal favorites/queue actions remain available during that worker (no uploadBusyGeneration guard in toggle). Their candidate comes from old Activity state. prepareLibrary overwrites the latest cache and deletes the pending original upload selector; its audio file remains but ordinary retry/recovery pointer disappears. An unobserved upload response can therefore no longer be recovered through the original pending UI, and a subsequent new upload may use a new key. Unrelated latest playback position/remote snapshot fields can be rolled back by the same full replacement.

Independent counterexample runs the actual frozen production MusicStore and static original file verifier using an existing known original local Android Context fixture. It captures the Activity-equivalent old cache, stages software WAV bytes through actual stageUpload, records the original upload pointer through actual updateUpload, persists newer position/playlist values, then passes the old candidate with a favorite edit to actual prepareLibrary. Observed: **uploadIntent false, position 99→0, newer playlist→original playlist, staged audio retained true**. The assertion requiring original pending upload selector preservation fails.

This is an executed local cache source model, not installed Activity/Looper or signed service evidence. No MusicApi, NativeSessionBridge, grant or SDK instance is constructed. The no-op cache guard is explicitly a controlled cache lifecycle input, never canonical authority. Real method/order reachability comes from the original normal caller and original background stage/update control flow, not a new auth adapter.

Required owner repair: merge the intended library fields and new exact libraryIntent into the latest original same-account Store state under the existing lock; preserve independent uploadIntent, remote snapshot, preferences, playback and other cache fields. Check same bounded complete caller batch, rather than changing the assertion or substituting a fixture Store.

## Other owned behavior and direct positive checks

MainActivity account tasks capture deep immutable request state and synchronous form values. API binding/native epoch checks precede requests and follow replies. UI publication checks authGeneration, snapshot read order and exact original account. Profile commits load latest Store, update only remote.profile and preserve independent fields. Download commits load latest remote catalog, verify original local WAV/hash and update availability before creating library intent. Remote markers alone never prove local playback/download availability.

Library Writer uses the original serial Activity executor, captures a deep exact intent and checks view/API before work. Older queued intents cannot consume a successor. Returned library confirmation must match account, favorites, queue and downloads exactly. Acknowledgement checks exact current original intent again under the Store lock and preserves other current fields. Exceptions/unobserved replies retain the intent. Snapshot refresh compares original remote listener tuple before removing that intent; matching cold readback does not itself issue PUT, while mismatches preserve desired local favorites/queue and pending intent. Refresh with unresolved desired state may invoke the normal original writer with current authority; no new protocol, grant or signing producer is introduced by this batch.

The original Go route remains `PUT /api/library`, fixed music.library capability, bounded 64KiB ordinary JSON, calling original UpdateLibrary; actor normalization, visibility checks, deduplication and retained unavailable records remain inherited. The service response is visible original listener state. API still signs/attaches original identity/business headers and exact body bytes, bounds responses, rejects redirects and verifies current binding. No changed SDK or service route/role is admitted here.

All tracked ordinary account dialogs are dismissed on retire/change/destroy, including overlap, playlist, upload, disclosures and report dialog. Existing view generation and callback guards remain. MainActivity onDestroy shuts down the serial library executor and retires UI callbacks. Source does not prove real Android lifecycle/Looper, file picker, codec, notification permission or installed revocation behavior.

Independent local cache checks: **4 PASS / 1 FAIL**, java exit 1.
PASS: (1) profile and verified download preserve latest pending upload/preferences; (2) same exact original library tuple cold Store readback clears pending intent without dispatch; (3) mismatched tuple preserves current desired queue and old intent cannot acknowledge successor; (4) selected other account refuses old cache commit.
FAIL: precise stale prepareLibrary full-cache counterexample above.

Probe SHA256 `8f1bd15d2112e04dc549705e0637707e4ce7e6aa2e8528fd6ef776b1d7d7e4c5`.
Raw log SHA256 `b5c80944a8e497b1b7dbd57ad4ff8196522083732cdfe38807ea4455067f85d7`.
Independent build receipt SHA256 `da4ddcb3eec798034d229ba3cf5bb4fcd0c8b2ecc282a0140129059b45dbdbec`.

JDK17 path and original public JSON library identity came from exact frozen compiled-java-source.json. JSON jar 78,332 bytes SHA256 `3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed` was freshly verified; source dependency pins freshly match frozen owner compilation pins. The exact original dependency classes were compiled into new review material, never replaced with a shim. The existing auth/network bridge classes were only compile-time dependencies and never constructed/called. Only cache methods, hashing and software test WAV files ran. No listener, HTTP/SDK adapter, real files, ENV, key, credential, grant, device or user approval was used. Source files remained intact.

## Preserved evidence and remaining gates

Owner full Go race/vet, original SDK+Java+Go loopback upload/library checks, four PUT counts, initial truncated reply/cold restore, Android build/full lint/debug signature and inherited Apple binaries remain owner engineering/custody only. They were not independently repeated or relabeled. Their existing Node wrapper starts a loopback listener and requires actual SDK; independently executing that graph is outside this batch, so real original HTTP PUT/readback/proofs and retired SDK worker behavior are **NOT_RUN** here. Source reasoning plus cache-only executed positives cannot stand in for those gates.

Checkpoint's inherited first wrong-account→same-account recovery failure remains unexplained and unclosed despite later owner greens. Current downloaded software WAV verification is distinct from real large-media/codec/device acceptance. Actual currentActor/role registration, formal original Host/profile/client mount, real Wallet and platform protected storage, installed Android/iOS/macOS lifecycle, genuine approval, public upload/publication/moderation/revenue/Pay and user acceptance remain NOT_RUN/NOT_VERIFIED. No device/UI/QA or Host was opened. Products/owner tree/index/dirty and all prior reports/failures are untouched.

Final: **Media6288 bounded Android SOURCE_HOLD** pending original owner's complete cross-field transaction repair. Docs exact version-restoration draft successor closes separately and does not override this finding or admit production authorization.
