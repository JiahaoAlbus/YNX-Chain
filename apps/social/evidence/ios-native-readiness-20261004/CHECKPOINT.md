# Existing iOS target: actual engineering build/install checkpoint

Base is exact owner 613801deeffd0805003c31bbaf5e5280e1313e37 apps/social archive with two explicit source overlays: the existing Podfile now selects the new consumer-only MatrixRustSDK.podspec. Exact overlay and component bytes are in build-checkpoint.json. This is not a build of the subsequently added Veil files.

Read-only SDK inventory: iPhoneSimulator27.0 SDK; available iOS18.5/26.2 runtimes; original YNXSocial target/scheme recognized (exit0). First unsigned Debug project build failed65 at missing Pods Manifest.lock. Normal pod install then failed1: the full MatrixRustSDK package is not a CocoaPods trunk pod. Official 26.09.07 release/tag does exist. Its Swift commit and binary checksum were verified against the pinned Package.swift and release metadata.

The local CocoaPods distribution bridge retained existing SDK26.9.7, official Swift source d66ebb38271b75b1f101ccbc927c340aff09c71b and FFI archive SHA256 ad34daa3dd57e1cdf3c241a496a9b6f257ac28e38ff977e5c7b0a18d496ef74a. No crypto-only substitution or new SDK version. Corrected isolated pod installation succeeded (97 Pods), then complete existing arm64 Simulator Debug workspace build succeeded with signing disabled. Installed/launched com.ynx.social1.0.0 in only the allocated new device1E9E47E1-7AFD-4F1C-8265-8161CC35C4E1; both exit0, launchPID87577.

This development bundle has no root main.jsbundle and is not established as standalone/offline runnable; Metro/development runtime must be provided for subsequent UI verification. Native process launch is not a successful React UI or private business flow.

Actual GUI observation could not run: CUA returned Invalid app for the official Simulator.app path; subsequent inventory had apps=[] and an explicit Mac-locked/automatic-unlock-unavailable error requiring ordinary user unlock. No alternate app locator, CLI screenshot/input, password or lock bypass was attempted. Only this own QA app/device was normally stopped, userdata preserved and exclusive UI window released. Other devices, accounts, settings, services, signing identities and Host untouched.

Actual guest/errors/recovery UI, encrypted delivery, new Veil engine, dot/MONSTER and product acceptance remain NOT_RUN/NOT_VERIFIED. No formal signed artifact, TestFlight, deployment or release approval. Local app is not a remotely carried deliverable; immutable evidence/source is committed separately. Historical failures remain preserved rather than relabeled as passing.
