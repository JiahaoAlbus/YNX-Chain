// Matching source regression only. Root supplier's actual parser/held-file
// delta evidence remains separate; no Root row or Native admission is inferred.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
const loader=fs.readFileSync(new URL('src/original-wallet-main-namespace-node-loader-private.js',root));
const native=fs.readFileSync(new URL('native/pay_root_postbuild.mm',root),'utf8');
const sha=crypto.createHash('sha256').update(loader).digest('hex');
assert.equal(loader.length,5763);
assert.equal(sha,'916cd30637dbd25ff79080947c44211348c48b754425b89a9c8811f4e233f0da');
const pins=[...native.matchAll(/if\(n!=(\d+)\|\|text\(pin\[@"sha256"\]\)!="([a-f0-9]{64})"\)throw Code::content;/g)];
assert.equal(pins.length,1);assert.equal(Number(pins[0][1]),loader.length);assert.equal(pins[0][2],sha);
assert.equal(native.includes('1da77024874d10a94f5845a5eeea0a8a3042ce6e9b1005e8e345f009754c1f68'),false);
const contract=JSON.parse(fs.readFileSync(new URL('integration/SDK332_R140_NATIVE_COMPATIBILITY.json',root)));
const declared=contract.NativeInputs.find(x=>x.path==='packages/wallet-auth/native/pay_root_postbuild.mm');
const bytes=Buffer.from(native);assert.equal(declared.bytes,bytes.length);assert.equal(declared.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
console.log(JSON.stringify({actualLoaderBytes:loader.length,actualLoaderSHA:sha,nativeProducerPinMatches:true,NativeInputMatches:true,RootAdmission:false,SourceAdmission:false,NativeWhole:false}));
