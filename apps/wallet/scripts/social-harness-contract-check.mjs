import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activity=await readFile(new URL("../proof/social-harness/app/src/main/java/com/ynx/social/MainActivity.java",import.meta.url),"utf8");
const manifest=await readFile(new URL("../proof/social-harness/app/src/main/AndroidManifest.xml",import.meta.url),"utf8");
const build=await readFile(new URL("../proof/social-harness/app/build.gradle",import.meta.url),"utf8");

for(const required of [
  'applicationId "com.ynx.social"',
  "compileSdk 36",
  "targetSdk 36",
])assert.ok(build.includes(required),`Social harness build contract is missing ${required}`);
for(const required of [
  'android:scheme="ynx-social"',
  'android:host="com.ynx.social"',
  'android:launchMode="singleTask"',
  'android:allowBackup="false"',
])assert.ok(manifest.includes(required),`Social harness callback manifest is missing ${required}`);
for(const required of [
  'private static final String CALLBACK="ynx-social://com.ynx.social"',
  'request.put("productClientId","ynx-social-v1")',
  'request.put("bundleId",getPackageName())',
  'request.put("productDeviceAlgorithm",DEVICE_ALGORITHM)',
  'request.put("scopes",new JSONArray().put("account:read").put("profile:link"))',
  'String encodedQuery=uri.getEncodedQuery()',
  'encodedQuery.matches("^response=[A-Za-z0-9_-]+$")',
  'uri.getUserInfo()!=null',
  'uri.getPort()!=-1',
  '!base64url(decoded).equals(encoded)',
  'issued.isBefore(requestIssued)',
  'issued.isAfter(now.plusSeconds(30))',
  'preferences.getBoolean("consumed."+nonce,false)',
  'preferences.edit().putBoolean("consumed."+nonce,true).apply()',
  'KeyStore.getInstance("AndroidKeyStore")',
  'new ECGenParameterSpec("secp256r1")',
  '"YNX_PRODUCT_SESSION_CHALLENGE_V1\\n"+canonical(challenge)',
])assert.ok(activity.includes(required),`Social harness runtime contract is missing ${required}`);
assert.equal(activity.includes('getQueryParameter("response")'),false,"Social harness must not collapse duplicate response parameters");
assert.ok(activity.indexOf('putBoolean("consumed."+nonce,true)')<activity.indexOf("createGatewayChallenge(response"),"callback replay state must persist before a Product Session challenge is created");
console.log("Social Android harness contract passed: exact callback route/envelope, canonical encoding, approval lifetime, replay-before-challenge, and Keystore P-256 binding");
