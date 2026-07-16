import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root=new URL(".",import.meta.url),required=["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"];
const catalog=JSON.parse(await readFile(new URL("i18n/catalog.json",root),"utf8"));
assert.deepEqual(Object.keys(catalog),required,"locale order and set must remain audited");
const keys=Object.keys(catalog.en);
assert(keys.length>=20,"catalog is too small for core native states");
for(const locale of required){assert.deepEqual(Object.keys(catalog[locale]),keys,`${locale} keys differ`);for(const key of keys)assert.equal(typeof catalog[locale][key]==="string"&&catalog[locale][key].trim()!=="",true,`${locale}.${key} blank`)}
for(const key of ["privacy","payment","walletPending","offline","unavailable","noMetrics"]){for(const locale of required.slice(1))assert.notEqual(catalog[locale][key],catalog.en[key],`${locale}.${key} silently fell back to English`)}
assert(/[\u0600-\u06ff]/u.test(catalog.ar.privacy),"Arabic critical text is not Arabic");
const android=await readFile(new URL("android/app/src/main/java/com/ynxweb4/video/MainActivity.java",root),"utf8"),manifest=await readFile(new URL("android/app/src/main/AndroidManifest.xml",root),"utf8"),swift=await readFile(new URL("ios/YNXVideo/ContentView.swift",root),"utf8"),plist=await readFile(new URL("ios/YNXVideo/Info.plist",root),"utf8"),studio=await readFile(new URL("../creator-studio/i18n.js",root),"utf8");
for(const source of [android,swift])for(const binding of ["ynx_6423-1","ynx-video-mobile-v1","com.ynxweb4.video","p256-sha256","ynxvideo://wallet-auth/callback"])assert(source.includes(binding),`native contract missing ${binding}`);
assert(manifest.includes('android:supportsRtl="true"')&&android.includes('LAYOUT_DIRECTION_RTL'),"Android RTL missing");
assert(plist.includes("ynxvideo")&&plist.includes("$(PRODUCT_BUNDLE_IDENTIFIER)"),"iOS identity/deep link missing");
for(const source of [android,swift,studio])for(const feature of ["formatDate","formatCurrency"]){const alternatives=feature==="formatCurrency"?["formatCurrency","format(currency","formatMoney"]:[feature,"format(date"] ;assert(alternatives.some(x=>source.includes(x)),`${feature} localization missing`)}
for(const feature of ["PluralRules","const plural="])assert(studio.includes(feature),`Web plural localization missing ${feature}`);
assert(swift.includes("layoutDirection")&&swift.includes('model.locale=="ar"'),"iOS RTL missing");
console.log(`i18n audit passed: ${required.length} locales, ${keys.length} exact keys, RTL and critical semantics`);
