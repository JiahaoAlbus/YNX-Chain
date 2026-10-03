import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const project=read('ios/YNXCard.xcodeproj/project.pbxproj'),scheme=read('ios/YNXCard.xcodeproj/xcshareddata/xcschemes/YNXCard.xcscheme'),plist=read('ios/YNXCard/Info.plist'),delegate=read('ios/YNXCard/AppDelegate.swift');
test('shared scheme references only actual app target, never a fabricated XCTest target',()=>{
  const ids=new Set([...project.matchAll(/([A-F0-9]{24}) \/\* [^\n]+ \*\/ = \{\s*isa = PBXNativeTarget;/g)].map(match=>match[1]));
  assert.equal(ids.size,1);for(const match of scheme.matchAll(/BlueprintIdentifier = "([A-F0-9]{24})"/g))assert.ok(ids.has(match[1]));
  assert.ok(!scheme.includes('YNXCardTests.xctest'));
});
test('Apple and Expo/package versions derive from the same actual product version',()=>{
  const app=JSON.parse(read('app.json')).expo,version=JSON.parse(read('package.json')).version;
  assert.equal(app.version,version);
  assert.deepEqual([...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(match=>match[1]),[version,version]);
  assert.ok(plist.includes('<string>$(MARKETING_VERSION)</string>'));
  assert.ok(plist.includes('<string>$(CURRENT_PROJECT_VERSION)</string>'));
  assert.ok(project.includes(`PRODUCT_BUNDLE_IDENTIFIER = "${app.ios.bundleIdentifier}";`));
});
test('existing native release entry uses an embedded bundle and keeps OS callback wiring',()=>{
  assert.match(delegate,/#else\s*return Bundle\.main\.url\(forResource: "main", withExtension: "jsbundle"\)/);
  assert.ok(delegate.includes('RCTLinkingManager.application(app, open: url'));
  assert.ok(delegate.includes('continue userActivity: NSUserActivity'));
  assert.ok(plist.includes('<string>ynxcard</string>'));
  assert.ok(plist.includes('<key>NSAllowsArbitraryLoads</key>\n      <false/>'));
});
