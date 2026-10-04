require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name = 'YnxFaucetTransport'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = { :type => 'UNLICENSED' }
  s.author = 'YNX'
  s.homepage = 'https://ynxweb4.com'
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/JiahaoAlbus/YNX-Chain.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
