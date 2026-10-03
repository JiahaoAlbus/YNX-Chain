Pod::Spec.new do |s|
  s.name = 'YNXSocialMatrix'
  s.version = '0.1.0'
  s.summary = 'YNX Social native Matrix consumer'
  s.homepage = 'https://social.ynxweb4.com'
  s.author = 'YNX Social'
  s.license = 'UNLICENSED'
  s.source = { :git => 'https://social.ynxweb4.com' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '*.{swift,h,m}'
  s.dependency 'ExpoModulesCore'
  s.dependency 'MatrixRustSDK', '= 26.9.7'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
