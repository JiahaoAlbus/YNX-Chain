import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activity=await readFile(new URL("../proof/social-harness/app/src/main/java/com/ynx/social/MainActivity.java",import.meta.url),"utf8");
const manifest=await readFile(new URL("../proof/social-harness/app/src/main/AndroidManifest.xml",import.meta.url),"utf8");
const build=await readFile(new URL("../proof/social-harness/app/build.gradle",import.meta.url),"utf8");
const requestGenerator=await readFile(new URL("../proof/social-harness/generate-canonical-request.mjs",import.meta.url),"utf8");
const endpointMatrix=JSON.parse(await readFile(new URL("../../../release/integration/wallet-auth-public-endpoint-service-discovery-matrix.json",import.meta.url),"utf8"));

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
  'EXTRA_CANONICAL_AUTHORIZE_URL="canonical_authorize_url"',
  'manager.resolveActivity(implicit,PackageManager.MATCH_DEFAULT_ONLY)',
  'manager.queryIntentActivities(implicit,PackageManager.MATCH_DEFAULT_ONLY)',
  'candidates.size()!=1',
  'implicit.setComponent(WALLET_ACTIVITY)',
  'WALLET_APP_UNAVAILABLE',
  'Download YNX Wallet',
  'Use MetaMask Mobile',
  'YNX_WALLET_DOWNLOAD_URL="https://www.ynxweb4.com/dapp/wallet"',
  'METAMASK_MOBILE_CANDIDATE_URL="https://metamask.app.link/dapp/www.ynxweb4.com/dapp/wallet"',
  'openWebAlternative(YNX_WALLET_DOWNLOAD_URL,"YNX Wallet download page")',
  'openWebAlternative(METAMASK_MOBILE_CANDIDATE_URL,"unverified MetaMask Mobile candidate")',
  'queryIntentActivities(view,PackageManager.MATCH_DEFAULT_ONLY)',
  'Intent.createChooser(view,label)',
  'Completion is not verified.',
  'verifyRequestBinding(request,Instant.now())',
  'String encodedQuery=uri.getEncodedQuery()',
  'encodedQuery.matches("^response=[A-Za-z0-9_-]+$")',
  'uri.getUserInfo()!=null',
  'uri.getPort()!=-1',
  '!base64url(decoded).equals(encoded)',
  'issued.isBefore(requestIssued)',
  'issued.isAfter(now.plusSeconds(30))',
  'persistPendingRequest(request)',
  'another authorization request is already pending',
  'putString(PENDING_REQUEST,canonical).commit()',
  'if(!consumeCallback(request))',
  'canonical.equals(pending)',
  'putBoolean(key,true).remove(PENDING_REQUEST).commit()',
  'callback terminal state was not durably stored',
  'pending request storage is not canonical',
  'verifyRequestBinding(request,Instant.now())',
  'Wallet approval is not bound to this Android Keystore device',
  'verifyWalletRejection(response,request,Instant.now())',
  '"USER_REJECTED".equals(rejection.getString("decisionCode"))',
  'rejection.getBoolean("authorityGranted")',
  'rejection.getJSONArray("grantedScopes").length()!=0',
  'Product Session count: 0',
  'KeyStore.getInstance("AndroidKeyStore")',
  'new ECGenParameterSpec("secp256r1")',
  '"YNX_PRODUCT_SESSION_CHALLENGE_V1\\n"+canonical(challenge)',
])assert.ok(activity.includes(required),`Social harness runtime contract is missing ${required}`);
for(const required of ['from "@ynx-chain/wallet-auth"','encodeRequestDeepLink(request)','parseAuthorizationRequest(','callback:"ynx-social://com.ynx.social"'])assert.ok(requestGenerator.includes(required),`Social harness shared request generator is missing ${required}`);
assert.equal(activity.includes('"ynxwallet://authorize?request="+'),false,"Social harness Android runtime must not concatenate an authorization URI");
assert.equal(activity.includes('getQueryParameter("response")'),false,"Social harness must not collapse duplicate response parameters");
assert.equal(activity.includes('.apply()'),false,"Social harness replay-critical state must not rely on asynchronous SharedPreferences apply");
assert.ok(activity.includes(`YNX_WALLET_DOWNLOAD_URL="${endpointMatrix.canonical.websiteUrl}"`),"Social harness YNX Wallet download action must consume the frozen website endpoint");
const metamaskCandidate=endpointMatrix.discoveryContract.modes.find(({id})=>id==="metamask-mobile-dapp-link")?.candidateUrl;
assert.equal(typeof metamaskCandidate,"string","frozen endpoint matrix must retain the MetaMask Mobile candidate");
assert.ok(activity.includes(`METAMASK_MOBILE_CANDIDATE_URL="${metamaskCandidate}"`),"Social harness MetaMask action must consume the frozen candidate without promoting it to verified");
assert.equal(activity.includes("createGatewayChallenge(response"),false,"Social harness must not fabricate a Product Session while the public Core mobile route is unproved");
console.log("Social Android harness contract passed: shared request builder, exact Android resolution, safe absence UI, authority-free rejection, replay safety, and zero fabricated Product Sessions");
