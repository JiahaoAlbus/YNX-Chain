Pod::Spec.new do |s|
  s.name = 'YNXPQCustody'
  s.version = '1.0.0'
  s.summary = 'Original protected mobile PQ custody bridge'
  s.homepage = 'https://ynxweb4.com'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'YNX'
  s.source = { :path => '.' }
  s.platforms = { :ios => '15.1' }
  s.source_files = 'ios/*.{mm,swift}', 'native/*.{h,hpp,cpp}', 'native/account-proof/*.{h,cpp}'
  s.pod_target_xcconfig = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17', 'DEFINES_MODULE' => 'YES', 'HEADER_SEARCH_PATHS' => '$(YNX_ACCOUNT_PROOF_INCLUDE_ROOTS)' }
  s.swift_version = '5.0'
  s.frameworks = 'Security', 'LocalAuthentication', 'UIKit'
  s.dependency 'React-Core'
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  # Original A must supply the matching Auth mobile implementation to the final
  # target, including the original P09 held-launch backend and sole SDK97
  # headers. No second Go/Node/App or alternate proof codec belongs in this pod.
  # Undefined Auth/custody/normalnative symbols fail normal linking.
end
