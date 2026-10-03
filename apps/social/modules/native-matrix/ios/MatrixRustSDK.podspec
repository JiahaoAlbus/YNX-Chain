# Consumer-only CocoaPods description of the official 26.09.07 Swift package.
# Do not substitute the crypto-only pod or silently advance the SDK version.
Pod::Spec.new do |s|
  s.name = 'MatrixRustSDK'
  s.version = '26.9.7'
  s.summary = 'Pinned official Matrix Rust SDK Swift package for YNX Social'
  s.homepage = 'https://github.com/matrix-org/matrix-rust-components-swift'
  s.author = 'Matrix.org Foundation'
  s.license = { :type => 'Apache-2.0', :file => 'LICENSE' }
  s.source = {
    :git => 'https://github.com/matrix-org/matrix-rust-components-swift.git',
    :commit => 'd66ebb38271b75b1f101ccbc927c340aff09c71b'
  }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = 'Sources/MatrixRustSDK/**/*.swift'
  s.vendored_frameworks = 'MatrixSDKFFI.xcframework'
  s.preserve_paths = 'LICENSE', 'Package.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.prepare_command = <<~SH
    set -eu
    /usr/bin/curl --fail --location --retry 2 --connect-timeout 30 --max-time 600 \
      'https://github.com/matrix-org/matrix-rust-components-swift/releases/download/26.09.07/MatrixSDKFFI.xcframework.zip' \
      -o MatrixSDKFFI.xcframework.zip
    printf '%s  %s\\n' \
      'ad34daa3dd57e1cdf3c241a496a9b6f257ac28e38ff977e5c7b0a18d496ef74a' \
      'MatrixSDKFFI.xcframework.zip' | /usr/bin/shasum -a 256 --check
    /usr/bin/unzip -q MatrixSDKFFI.xcframework.zip
    /bin/rm MatrixSDKFFI.xcframework.zip
  SH
end
