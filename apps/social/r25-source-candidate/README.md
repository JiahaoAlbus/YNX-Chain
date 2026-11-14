# Social R25 client source candidate

This directory preserves the R25 welcome, moments, messages and contacts client source and the associated Android client source for review. It is a source candidate, not the application's normal build root, an installable package, or evidence that login, device authorization, messaging, or recovery works.

The frontend is the dependency closure of the R25 `index.ts` entry, including the contact-navigation and directory-reopen changes. The Android source includes the matching directory-close and reopen changes. Two focused frontend tests are included.

This snapshot intentionally cannot build on its own. It omits the Android application wrapper and signing configuration, QA loopback TLS certificate source, binary carriers, generated assets, native Source/SDK/Auth producers, and the source-bound build receipts and pins. `app.config.js` names additional assets not present here. The retained module Gradle files refer to build inputs outside this directory and pin a previous source/carrier; they are provided for dependency review, not as an admission to use an old carrier. Re-export Hermes and regenerate matching source and carrier pins through the original build owner before any build. Do not remove the admission checks or replace unavailable authorization with fixture data.

Third-party dependencies must be obtained from their original distributions with their applicable licenses and transitive notices. No third-party binaries are included here; the precise Android dependency and binary notice review remains outstanding. The module package is marked `UNLICENSED`; this candidate does not purport to grant a separate license. Local accounts, keys, build outputs, machine-specific paths, and the unfinished server Native WIP are not included.

Unknown outcomes, pending operations and historical data remain subject to the original-owner recovery rules; a source commit is not a device or end-to-end acceptance result.
