import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {SUPPORTED_LOCALES} from "./i18n";
import {SCANNER_COPY_KEYS,scannerCopy} from "./scannerCopy";
test("shared Android/iOS scanner explains permission, manual fallback and non-approval in all twelve locales",()=>{
for(const key of SCANNER_COPY_KEYS){const distinct=new Set<string>();for(const locale of SUPPORTED_LOCALES){const value=scannerCopy(locale,key);assert.ok(value.trim().length>0,`${locale}:${key}`);assert.doesNotMatch(value,/[\u202a-\u202e\u2066-\u2069]/u);distinct.add(value)}assert.equal(distinct.size,12,key)}
assert.match(scannerCopy("en","reviewOnly"),/never approves/);assert.match(scannerCopy("zh-Hans","reviewOnly"),/不会批准转账/);assert.match(scannerCopy("ar","reviewOnly"),/لا يوافق/);
});
test("shared scanner preserves OS font scaling, camera-only permission and RTL without a second platform business implementation",async()=>{
const source=await readFile(new URL("../state/WalletScanner.tsx",import.meta.url),"utf8");
assert.match(source,/scannerCopy\(locale,key\)/);assert.doesNotMatch(source,/locale===\"zh-Hans\"/);assert.match(source,/isRTL\(locale\)/);assert.match(source,/minHeight:44/);assert.match(source,/writingDirection:\"rtl\"/);
assert.doesNotMatch(source,/allowFontScaling=\{false\}|maxFontSizeMultiplier|recordAudio|Platform\.OS/);assert.match(source,/requestPermission\(\)/);assert.match(source,/barcodeTypes:\[\"qr\"\]/);
});
