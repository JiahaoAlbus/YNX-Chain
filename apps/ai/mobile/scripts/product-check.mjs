import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";

const app=await readFile(new URL("../App.tsx",import.meta.url),"utf8");
const api=await readFile(new URL("../src/api.ts",import.meta.url),"utf8");
const manifest=await readFile(new URL("../android/app/src/main/AndroidManifest.xml",import.meta.url),"utf8");
const debugManifest=await readFile(new URL("../android/app/src/debug/AndroidManifest.xml",import.meta.url),"utf8");
const optimizedManifest=await readFile(new URL("../android/app/src/debugOptimized/AndroidManifest.xml",import.meta.url),"utf8");
const config=JSON.parse(await readFile(new URL("../app.json",import.meta.url),"utf8"));
assert.equal(config.expo.ios.bundleIdentifier,"com.ynxweb4.ai");
assert.equal(config.expo.android.package,"com.ynxweb4.ai");
assert.equal(config.expo.scheme,"ynxai");
assert.deepEqual(config.expo.android.permissions,[]);
assert.match(app,/DocumentPicker\.getDocumentAsync/);
assert.match(app,/streamGeneration/);
assert.match(app,/I18nManager\.forceRTL/);
assert.match(app,/accessibilityLabel/);
assert.doesNotMatch(app,/WebView|react-native-webview/);
assert.match(api,/xhr\.open\("POST"/);
assert.match(api,/walletUrl/);
assert.doesNotMatch(api,/\?prompt=|searchParams\.set\(["']prompt/);
assert.doesNotMatch(manifest+debugManifest+optimizedManifest,/SYSTEM_ALERT_WINDOW/);
for(const permission of ["READ_EXTERNAL_STORAGE","WRITE_EXTERNAL_STORAGE"]){
  assert.match(manifest,new RegExp(`<uses-permission[^>]+${permission}[^>]+tools:node="remove"`),`${permission} must be removed from the merged manifest`);
}
assert.doesNotMatch(app+api,/OPENAI_API_KEY|ANTHROPIC_API_KEY|sk-[A-Za-z0-9]/);
const nativeDirs=await Promise.all(["android","ios"].map(async value=>{try{return (await readdir(new URL(`../${value}`,import.meta.url))).length>0}catch{return false}}));
if(process.env.REQUIRE_NATIVE_PROJECTS==="1") assert.ok(nativeDirs.every(Boolean),"Android and iOS native projects are required");
console.log(JSON.stringify({ok:true,bundleId:"com.ynxweb4.ai",scheme:"ynxai",postBodyOnly:true,noWebView:true,noBroadAndroidPermissions:true,nativeProjects:nativeDirs}));
