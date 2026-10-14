import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {selectCurrentMediaSdk,CURRENT_MEDIA_SDK_HEAD} from './current-media-sdk.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=path=>readFileSync(join(root,path),'utf8');

test('current Media browser/native entry selects full R9 source and same-copy R7/R8/Auth closure',()=>{
 for(const profile of ['browser','native']){
  const s=selectCurrentMediaSdk(root,profile);assert.equal(s.sourceCommit,CURRENT_MEDIA_SDK_HEAD);assert.equal(s.pins.size,276);
  assert.equal(readFileSync(s.entryPath,'utf8'),s.entry);assert.match(s.entry,/createProductWalletConnection/);
  const factory=readFileSync(join(s.packageRoot,'src/product-wallet-connection.js'),'utf8');
  assert.match(factory,/\.\/wallet-connection-coordinator\.js/);assert.match(factory,/\.\/product-session-recovery\.js/);
  for(const file of ['src/wallet-connection-coordinator.js','src/product-session-recovery.js','src/product-session-gateway-client.js','src/product-session-browser.js'])assert.ok(s.pins.has('packages/wallet-auth/'+file));
 }
 assert.throws(()=>selectCurrentMediaSdk(root,'old-r7'),/Unknown/);
});
test('normal Media loaders use new artifacts and preserve registered origin and explicit environment',()=>{
 const video=read('apps/video/product-session.js'),creator=read('apps/creator-studio/product-session.js'),music=read('apps/music/web/canonical-release.js'),native=read('apps/video/native/media-session.mjs');
 for(const text of [video,creator,music,native])assert.match(text,/2689bece12fddd991c2ecd7a024f6aa4e8b1afbd/);
 assert.match(video,/import\('\.\/product-session-sdk-r9\.js'\)/);assert.match(creator,/import\('\.\/product-session-sdk-r9\.js'\)/);
 assert.match(video,/gateway, environment/);assert.match(creator,/environment:globalThis/);assert.match(music,/gateway,environment/);
 assert.match(video,/environment\.location\?\.origin === VIDEO_ORIGIN/);assert.match(music,/isSecureContext!==true/);
 assert.match(native,/business-scope\.js/);assert.doesNotMatch(native,/from .*product-session\.js/);
 assert.match(native,/createNativeProductSessionClient/);assert.doesNotMatch(native,/await createProductWalletConnection/);
});
test('normal owning builders select current profiles without reusing historical artifacts',()=>{
 for(const file of ['apps/video/scripts/build-native-engine.mjs','apps/video/scripts/build-apple-native-engine.mjs','apps/music/scripts/build-native-engine.mjs','apps/music/scripts/build-apple-native-engine.mjs','apps/creator-studio/scripts/build-apple-native-engine.mjs']){
  const text=read(file);assert.match(text,/prepareCurrentNativeSdk/);assert.doesNotMatch(text,/wallet-auth-5c5e8a23/);assert.match(text,/2689bece/);
 }
 assert.match(read('apps/video/scripts/build-runtime.sh'),/build-current-media-sdk/);
 assert.match(read('apps/creator-studio/build.mjs'),/buildCurrentMediaSdk/);
 assert.match(read('apps/music/webfs.go'),/go:generate node scripts\/build-current-web-sdk\.mjs/);
 for(const product of ['video','creator-studio'])assert.match(read(`apps/${product}/server.mjs`),/product-session-sdk-r9\.js/);
});
