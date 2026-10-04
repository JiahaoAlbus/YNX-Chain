import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

test("actual iOS deployment floor raises old resource targets without lowering dependencies or changing other settings",()=>{
  const helper=fileURLToPath(new URL("../ios/deployment-target-floor.rb",import.meta.url));
  const result=spawnSync("/usr/bin/ruby",["-e",`
require 'json'
require ARGV.fetch(0)
configuration=Struct.new(:build_settings)
target=Struct.new(:build_configurations)
project=Struct.new(:targets)
installer=Struct.new(:pods_project)
values=['12.4','13.4','16.4','17.0','27.0','$(inherited)',nil]
configs=values.map{|value|configuration.new({'IPHONEOS_DEPLOYMENT_TARGET'=>value,'OTHER_SETTING'=>'unchanged'})}
ynx_wallet_raise_pod_deployment_targets(installer.new(project.new([target.new(configs)])), '16.4')
puts JSON.generate(configs.map(&:build_settings))
`,helper],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  const values=JSON.parse(result.stdout);
  assert.deepEqual(values.map((item:any)=>item.IPHONEOS_DEPLOYMENT_TARGET),["16.4","16.4","16.4","17.0","27.0","$(inherited)",null]);
  assert.ok(values.every((item:any)=>item.OTHER_SETTING==="unchanged"));
});
test("original Wallet Podfile applies the floor after normal React Native installation using the same configured app minimum",()=>{
  const source=readFileSync(new URL("../ios/Podfile",import.meta.url),"utf8");
  assert.match(source,/require_relative 'deployment-target-floor'/);
  assert.match(source,/wallet_ios_deployment_target = podfile_properties\['ios.deploymentTarget'\] \|\| '16\.4'/);
  assert.match(source,/platform :ios, wallet_ios_deployment_target/);
  assert.ok(source.indexOf("ynx_wallet_raise_pod_deployment_targets(installer, wallet_ios_deployment_target)")>source.indexOf("react_native_post_install("));
  assert.match(source,/target 'YNXWallet' do/);assert.match(source,/:mac_catalyst_enabled => false/);
});
test("iOS source modules cannot borrow Expo binaries linked against an unavailable prebuilt React framework",()=>{
  const properties=JSON.parse(readFileSync(new URL("../ios/Podfile.properties.json",import.meta.url),"utf8"));
  assert.equal(properties["ios.usePrecompiledModules"],"false");
  assert.equal(properties["ios.buildReactNativeFromSource"],"true");
  const source=readFileSync(new URL("../ios/Podfile",import.meta.url),"utf8");
  const start=source.indexOf("ENV['EX_DEV_CLIENT_NETWORK_INSPECTOR']"),end=source.indexOf("wallet_ios_deployment_target =",start);
  assert.ok(start>=0&&end>start);
  const result=spawnSync("/usr/bin/ruby",["-e",`
require 'json'
podfile_properties=JSON.parse(ARGV.fetch(0))
ENV['EXPO_USE_PRECOMPILED_MODULES']='1'
ENV.delete('RCT_USE_RN_DEP')
ENV.delete('RCT_USE_PREBUILT_RNCORE')
${source.slice(start,end)}
puts [ENV.fetch('EXPO_USE_PRECOMPILED_MODULES'),ENV.fetch('RCT_USE_RN_DEP'),ENV.fetch('RCT_USE_PREBUILT_RNCORE')].join(',')
`,JSON.stringify(properties)],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),"0,0,0");
});
