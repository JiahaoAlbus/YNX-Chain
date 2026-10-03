Pod::Spec.new do |s|
  s.name = 'MatrixRustSDK'
  s.version = '26.9.7'
  s.summary = 'Pinned official Matrix Rust Swift bindings'
  s.homepage = 'https://github.com/matrix-org/matrix-rust-components-swift'
  s.license = { :type => 'Apache-2.0', :file => 'LICENSE' }
  s.author = 'The Matrix.org Foundation C.I.C.'
  s.source = { :git => 'https://github.com/matrix-org/matrix-rust-components-swift.git', :commit => 'd66ebb38271b75b1f101ccbc927c340aff09c71b' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.7'
  s.static_framework = true
  s.source_files = 'Sources/MatrixRustSDK/**/*.swift'
  s.vendored_frameworks = 'MatrixSDKFFI.xcframework'
  s.libraries = 'c++', 'sqlite3'
  s.frameworks = 'Security', 'SystemConfiguration'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.prepare_command = <<-CMD
    set -eu
    curl --fail --location --proto '=https' --tlsv1.2 --retry 2 'https://github.com/matrix-org/matrix-rust-components-swift/releases/download/26.09.07/MatrixSDKFFI.xcframework.zip' -o MatrixSDKFFI.zip
    printf '%s\n' 'ad34daa3dd57e1cdf3c241a496a9b6f257ac28e38ff977e5c7b0a18d496ef74a  MatrixSDKFFI.zip' | shasum -a 256 -c -
    unzip -q MatrixSDKFFI.zip
    rm MatrixSDKFFI.zip
  CMD
end
