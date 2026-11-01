Pod::Spec.new do |s|
  s.name = 'YNXPQCustody'
  s.version = '1.0.0'
  s.summary = 'Original protected mobile PQ custody bridge'
  s.homepage = 'https://ynxweb4.com'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'YNX'
  s.source = { :path => '.' }
  s.platforms = { :ios => '15.1' }
  s.source_files = 'ios/*.{mm,swift}', 'native/*.{h,cpp}'
  s.pod_target_xcconfig = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17', 'DEFINES_MODULE' => 'YES' }
  s.swift_version = '5.0'
  s.frameworks = 'Security', 'LocalAuthentication', 'UIKit'
  s.dependency 'React-Core'
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  # Original A must supply the matching Auth mobile implementation to the final
  # target. Undefined ynx_auth_mobile_pq_* / custody symbols fail normal linking.
end
