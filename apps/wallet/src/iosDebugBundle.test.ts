import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const source=readFileSync(process.env.YNX_IOS_APP_DELEGATE_SOURCE??new URL("../ios/YNXWallet/AppDelegate.swift",import.meta.url),"utf8");
const start=source.indexOf("  override func bundleURL() -> URL? {");assert.notEqual(start,-1);
let end=start,depth=0,began=false;
for(;end<source.length;end++){if(source[end]==="{"){depth++;began=true;}else if(source[end]==="}"&&--depth===0&&began){end++;break;}}
const method=source.slice(start,end);
let executable:string;
function run(location:string,reachable:boolean){
 if(!executable){
  const directory=mkdtempSync(join(tmpdir(),"ynx-wallet-ios-debug-bundle-"));executable=join(directory,"probe");
  // Compile the actual Swift method against API-shaped stubs. This isolates
  // routing policy; native framework compatibility is verified by xcodebuild.
  const harness=`import Foundation
class Base {func bundleURL() -> URL? {nil}}
class RCTBundleURLProvider {
 static let shared = RCTBundleURLProvider()
 var jsLocation: String? = nil
 var enableDev = false
 var enableMinification = true
 var inlineSourceMap = true
 var reachable = false
 static func sharedSettings() -> RCTBundleURLProvider {shared}
 func jsBundleURL(forBundleRoot: String) -> URL? {
  let host = reachable && !(jsLocation ?? "").isEmpty ? jsLocation! : "localhost:8081"
  return URL(string: "http://\\(host)/\\(forBundleRoot).bundle?route=guess")
 }
 static func jsBundleURL(forBundleRoot: String,packagerHost: String,enableDev: Bool,enableMinification: Bool,inlineSourceMap: Bool) -> URL? {
  URL(string: "http://\\(packagerHost)/\\(forBundleRoot).bundle?dev=\\(enableDev)&minify=\\(enableMinification)&inline=\\(inlineSourceMap)&route=explicit")
 }
}
class NativeDelegate: Base {${method}}
RCTBundleURLProvider.shared.jsLocation = CommandLine.arguments[1] == "<unset>" ? nil : CommandLine.arguments[1]
RCTBundleURLProvider.shared.reachable = CommandLine.arguments[2] == "true"
print(NativeDelegate().bundleURL()?.absoluteString ?? "nil")
`;
  const file=join(directory,"main.swift");writeFileSync(file,harness);
  const result=spawnSync("xcrun",["swiftc","-DDEBUG",file,"-o",executable],{encoding:"utf8",timeout:60000});assert.equal(result.status,0,result.stderr);
 }
 const result=spawnSync(executable,[location,String(reachable)],{encoding:"utf8",timeout:15000});assert.equal(result.status,0,result.stderr);return new URL(result.stdout.trim());
}
for(const location of ["127.0.0.1:8896","localhost:8896"])test(`explicit unavailable debug host ${location} never guesses another Metro`,{skip:process.platform!=="darwin"},()=>{
 const result=run(location,false);assert.equal(result.port,"8896");assert.equal(result.searchParams.get("route"),"explicit");assert.equal(result.pathname,"/.expo/.virtual-metro-entry.bundle");
});
test("explicit debug route preserves the original RN development options",{skip:process.platform!=="darwin"},()=>{
 const result=run("localhost:8896",true);assert.equal(result.searchParams.get("dev"),"false");assert.equal(result.searchParams.get("minify"),"true");assert.equal(result.searchParams.get("inline"),"true");
});
for(const location of ["<unset>",""])test(`unspecified ${JSON.stringify(location)} debug location retains normal RN discovery`,{skip:process.platform!=="darwin"},()=>{assert.equal(run(location,false).searchParams.get("route"),"guess")});
test("release continues to use the original embedded bundle, not a development server",()=>{assert.match(method,/#else\s+return Bundle\.main\.url\(forResource: "main", withExtension: "jsbundle"\)\s+#endif/)});
