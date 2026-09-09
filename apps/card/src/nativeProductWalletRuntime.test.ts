import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const root=new URL("./",import.meta.url);
const runtime=readFileSync(new URL("productWalletRuntime.ts",root),"utf8");
const secureStore=readFileSync(new URL("../node_modules/expo-secure-store/build/SecureStore.js",root),"utf8");

test("Card native identity maps every Product Session storage key through the installed Expo SecureStore 57 boundary",()=>{
  const key=runtime.match(/CARD_PRODUCT_SESSION_DEVICE_STORE_KEY="([^"]+)"/)?.[1];
  assert.equal(key,"ynx-card-product-session-v2-device");
  assert.match(key,/^[\w.-]+$/);
  assert.doesNotMatch(key,/:/);
  assert.match(secureStore,/\/\^\[\\w.\-\]\+\$\/\.test\(key\)/);
  assert.match(runtime,/mappedStorageKey\(platform,key\)/);
  assert.match(runtime,/createVerifiedProductSessionStorage/);
  assert.match(runtime,/storage:protectedStorage\(platform,\(\)=>launchLease\(\)===expectedLaunchLease\)/);
  assert.match(runtime,/markUncertain:\(\)=>\{nativeIdentityStorageUncertain=true;\}/);
  assert.match(runtime,/Existing Card native identity storage is invalid; it was not replaced/);
  assert.match(runtime,/let nativeIdentityStorageUncertain=false/);
  assert.match(runtime,/if\(nativeIdentityStorageUncertain\)throw/);
  assert.match(runtime,/nativeIdentityStorageUncertain=true/);
  assert.match(runtime,/let protectedDeviceInitialization:Promise/);
  assert.match(runtime,/if\(protectedDeviceInitialization\)return protectedDeviceInitialization/);
  assert.match(runtime,/Native identity storage became uncertain during initialization/);
  assert.match(runtime,/Native identity storage became uncertain before publication/);
});

test("Card native controller is single-flight, serializes SDK mutations, and cancels stale callbacks",()=>{
  const app=readFileSync(new URL("../App.tsx",root),"utf8"),connection=readFileSync(new URL("productWalletConnection.ts",root),"utf8");
  assert.match(app,/productWalletPromise/);
  assert.match(app,/nativeWalletOperation/);
  assert.match(app,/nativeWalletGeneration/);
  assert.match(app,/nativeWalletCallbackBlocked/);
  assert.match(app,/nativeWalletLaunchLease/);
  assert.match(app,/nativeWalletLaunchLease\.current\+=1;nativeWalletCallbackBlocked\.current=true/);
  assert.match(app,/if\(nativeWalletOperation\.current\)\{await nativeWalletOperation\.current;return;\}/);
  assert.match(runtime,/const lease=launchLease\(\)/);
  assert.match(runtime,/if\(launchLease\(\)!==lease\)/);
  assert.match(runtime,/expectedLaunchLease/);
  assert.match(runtime,/launchLease\(\)!==expectedLaunchLease/);
  assert.match(app,/nativeProductWalletLease/);
  assert.match(app,/getNativeProductWallet\(lease\)/);
  assert.match(app,/nativeWalletLaunchLease\.current!==lease/);
  assert.match(app,/productWallet\.current=null;productWalletPromise\.current=null/);
  assert.match(readFileSync(new URL("productWalletStorage.ts",root),"utf8"),/let sharedNativeStorageTail:Promise<void>=Promise\.resolve\(\)/);
  assert.match(readFileSync(new URL("productWalletStorage.ts",root),"utf8"),/NativeStorageOwnerExpiredError/);
  assert.match(connection,/isNativeStorageOwnerExpiredError/);
  assert.match(connection,/status:"wallet-open-failed",code:"USER_REJECTED"/);
  assert.match(app,/callbackGeneration===nativeWalletGeneration\.current&&!nativeWalletCallbackBlocked\.current\)setBusy\(false\)/);
  assert.match(connection,/const serial=/);
  assert.match(connection,/retryYNX:async\(\)=>await serial/);
  assert.match(connection,/handleReturn:async\(url\)=>await serial/);
  assert.match(connection,/disconnect:async\(\)=>await serial/);
  assert.match(connection,/void run\.then\(\(\)=>\{if\(activeBegin===run\)activeBegin=null;\},\(\)=>\{if\(activeBegin===run\)activeBegin=null;\}\)/);
  assert.doesNotMatch(app,/ynxwallet:\/\/authorize|Linking\.openURL/);
});
