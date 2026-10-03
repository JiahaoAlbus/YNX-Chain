# Native image preview predecode budget checkpoint

The owned Android/iOS SDK media adapters now gate preview-handle issuance on image metadata resource budgets, after SDK file/path/size validation. No message, file, crypto, model, session, or audience semantics are replaced.

Android native compilation and five JUnit budget/GIF tests passed using the existing offline Gradle toolchain. Thirteen additional checks ran against the actual compiled Kotlin guard: original public logo, static PNG/WebP headers, conservative APNG counting, declared/observed animation floods, missing/truncated chunks, short WebP frames and RIFF length mismatch. Synthetic headers are not valid-raster or device-decoder proof.

The first Swift attempt stopped with tool exit 69 because Xcode initialization was incomplete. That historical log remains intact. After the controller reported normal initialization complete, the existing Swift helper compiled successfully on macOS and all twelve actual Foundation/ImageIO public-logo metadata and pure budget checks passed. This is portable iOS helper source checked on the host, not an iOS application build, simulator installation or device acceptance. Social did not accept a license, change the global developer directory, download a runtime or collect credentials.

Device BitmapFactory behavior, installed UI, real Matrix encrypted delivery, historical identity/multi-node/device recovery, admitted local AI models and actual dot/MONSTER acceptance remain NOT_VERIFIED/NOT_RUN. This is not Social completion or a release request.

## Reproduction

Android: existing Java 17 and Android SDK, from apps/social/android:

```sh
./gradlew :ynx-social-native-matrix:testReleaseUnitTest --offline --no-daemon --max-workers=2
```

Header harness: compile scripts/media-preview-bounds-qa/HeaderBudgetCheck.java with Java 17 against modules/native-matrix/android/build/tmp/kotlin-classes/release and the project's cached Kotlin stdlib. Run with two arguments: a fresh isolated fixture directory and assets/ynx-original-logo.png. The harness never reads user media or creates raster bitmaps.

Swift: using the normally initialized Xcode toolchain, compile modules/native-matrix/ios/ImagePreviewBounds.swift together with scripts/media-preview-bounds-qa/check.swift. Run with assets/ynx-original-logo.png as its argument. Both commands returned exit 0 at this checkpoint.

checkpoint.json binds exact source/log bytes and git blobs to the enclosing owner commit. Raw logs and JUnit XML are preserved. Temporary fixture/stage paths and prior private device data are not committed.
