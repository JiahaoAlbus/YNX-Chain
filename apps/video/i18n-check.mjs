import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root=new URL(".",import.meta.url),required=["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"];
const catalog=JSON.parse(await readFile(new URL("i18n/catalog.json",root),"utf8"));
assert.deepEqual(Object.keys(catalog),required,"locale order and set must remain audited");
const keys=Object.keys(catalog.en);
assert(keys.length>=20,"catalog is too small for core native states");
for(const locale of required){assert.deepEqual(Object.keys(catalog[locale]),keys,`${locale} keys differ`);for(const key of keys)assert.equal(typeof catalog[locale][key]==="string"&&catalog[locale][key].trim()!=="",true,`${locale}.${key} blank`)}
for(const key of ["privacy","payment","walletPending","offline","unavailable","noMetrics","signIn"]){for(const locale of required.slice(1))assert.notEqual(catalog[locale][key],catalog.en[key],`${locale}.${key} silently fell back to English`)}
assert(/[\u0600-\u06ff]/u.test(catalog.ar.privacy),"Arabic critical text is not Arabic");
const swiftFiles=["ContentView.swift","VideoModel.swift","VideoNativeCore.swift","ProductDeviceKey.swift"];
const project=await readFile(new URL("ios/YNXVideo.xcodeproj/project.pbxproj",root),"utf8");
const objects=[...project.matchAll(/\b(\w+)\s*=\s*\{([^{}]*)\};/g)].map(([,id,body])=>({id,body}));
const sources=objects.filter(({body})=>/isa\s*=\s*PBXSourcesBuildPhase;/.test(body)).flatMap(({body})=>(body.match(/files\s*=\s*\(([^)]*)\)/)?.[1]||'').split(',').map(id=>id.trim()));
for(const file of swiftFiles){
 const reference=objects.find(({body})=>body.includes(`path = YNXVideo/${file};`));
 const build=reference&&objects.find(({body})=>body.includes(`fileRef = ${reference.id};`));
 assert(build&&sources.includes(build.id),`${file} is not in the native build`);
}
const swift=(await Promise.all(swiftFiles.map(file=>readFile(new URL(`ios/YNXVideo/${file}`,root),"utf8")))).join("\n");
const android=await readFile(new URL("android/app/src/main/java/com/ynxweb4/video/MainActivity.java",root),"utf8"),manifest=await readFile(new URL("android/app/src/main/AndroidManifest.xml",root),"utf8"),plist=await readFile(new URL("ios/YNXVideo/Info.plist",root),"utf8"),web=await readFile(new URL("i18n.js",root),"utf8");
const androidContract=(await Promise.all(['MainActivity.java','NativeProductState.java','NativeProtectedRuntime.java','NativeSessionIdentity.java','NativeSessionBridge.java'].map(file=>readFile(new URL(`android/app/src/main/java/com/ynxweb4/video/${file}`,root),'utf8')))).join('\n');
for(const source of [androidContract,swift])for(const binding of ["ynx_6423-1","ynx-video-mobile-v1","com.ynxweb4.video","p256-sha256","ynxvideo://wallet-auth/callback"])assert(source.includes(binding),`native contract missing ${binding}`);
assert(manifest.includes('android:supportsRtl="true"')&&android.includes('LAYOUT_DIRECTION_RTL'),"Android RTL missing");
assert(plist.includes("ynxvideo")&&plist.includes("$(PRODUCT_BUNDLE_IDENTIFIER)"),"iOS identity/deep link missing");
for(const source of [android,swift])for(const feature of ["formatDate","formatCurrency"]){const alternatives=feature==="formatCurrency"?["formatCurrency","format(currency","formatMoney"]:[feature,"format(date"] ;assert(alternatives.some(x=>source.includes(x)),`${feature} localization missing`)}
assert(web.includes('document.documentElement.dir=locale==="ar"?"rtl":"ltr"'),"Web RTL direction missing");
assert(web.includes('let catalog={};'),"Web catalog must remain replaceable after a successful fetch");
assert(web.includes('new URL("./i18n/catalog.json",import.meta.url)'),"Web catalog must resolve under the public /video/ route");
assert(swift.includes("layoutDirection")&&swift.includes('model.locale=="ar"'),"iOS RTL missing");
console.log(`i18n audit passed: ${required.length} locales, ${keys.length} exact keys, RTL and critical semantics`);
