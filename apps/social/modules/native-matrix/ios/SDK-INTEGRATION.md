# Official SDK distribution bridge

The upstream full Matrix Rust SDK is a Swift package. The CocoaPods trunk API
has no `MatrixRustSDK` pod. A bare `s.dependency 'MatrixRustSDK', '= 26.9.7'`
therefore cannot resolve on a clean installation without a local description.
The separate crypto-only CocoaPod is not a replacement for the full client.

Social's existing exact version is retained: upstream tag `26.09.07` maps to
the CocoaPods version `26.9.7`. The local MatrixRustSDK.podspec is a distribution
adapter only. It does not fork the generated Swift bindings, rebuild Rust,
replace crypto or alter any shared Wallet/Auth interface.

- Upstream repository: https://github.com/matrix-org/matrix-rust-components-swift
- Swift source commit: `d66ebb38271b75b1f101ccbc927c340aff09c71b`
- Rust source referenced by the release: `48e07662de89d626c1ee0349ee44c5553ca30eb7`
- Official binary: https://github.com/matrix-org/matrix-rust-components-swift/releases/download/26.09.07/MatrixSDKFFI.xcframework.zip
- Binary bytes: `284685478`
- Binary SHA256: `ad34daa3dd57e1cdf3c241a496a9b6f257ac28e38ff977e5c7b0a18d496ef74a`

The binary checksum agrees with both the pinned upstream Package.swift and the
GitHub release asset digest. The prepare command checks it before extraction;
download or integrity failure stops installation. Apache-2.0 LICENSE is retained.
The source and binary are third-party build inputs, not Social release artifacts.
No downloaded SDK binary or private credential should be committed to Git.

The existing Social Podfile selects this local podspec; Expo autolinking retains
the existing YNXSocialMatrix consumer and its exact dependency. Ordinary pod
installation runs in an isolated source snapshot for engineering validation.
Formal signing, deployment and publication remain with the release owner.

Successful dependency resolution alone is not successful app compilation,
installation, actual encrypted messaging or user acceptance. Those checks must
be recorded separately with exact source and runtime identities.
