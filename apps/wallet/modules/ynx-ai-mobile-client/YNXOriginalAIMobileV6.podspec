require 'json'
pair = JSON.parse(File.read(File.join(__dir__, 'RESPONSE_CARRIER_PINS.json')))
raise 'Matching whole Auth/SDK signed response successor required; no old-body hot mix' if pair['authMatchedPair'].nil?
Pod::Spec.new do |s|
  s.name = 'YNXOriginalAIMobileV6'
  s.version = '0.1.0'
  s.summary = 'Thin original AI V6 CxxTurboModule; one A-owned Auth/Core runtime'
  s.homepage = 'https://ynxweb4.com'
  s.license = { :type => 'Proprietary' }
  s.author = 'YNX'
  s.platform = :ios, '15.1'
  s.source = { :path => '.' }
  s.source_files = 'native/**/*.{h,hpp,cpp}', 'ios/*.{h,mm}'
  s.pod_target_xcconfig = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20', 'HEADER_SEARCH_PATHS' => '$(PODS_TARGET_SRCROOT)/native $(YNX_AI_MATCHING_AUTH_INCLUDE_ROOTS)' }
  s.dependency 'React-Core'
  s.dependency 'ReactCommon/turbomodule/core'
  s.dependency 'React-jsi'
  # No vendored/static Auth/Go archive. A supplies matching strong bodies ONCE
  # in its selected combined final image; this pod alone is not an admission.
end
