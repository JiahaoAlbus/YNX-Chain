import assert from "node:assert/strict";
import test from "node:test";
import { encodeRequestDeepLink, parseWalletDeepLink } from "@ynx-chain/wallet-auth";
import { generateCanonicalSocialAuthorization } from "./generate-canonical-request.mjs";

const DEVICE_KEY="AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv";
const NOW=new Date("2026-08-15T01:00:00.000Z");
const NONCE="social_api36_abcdefghijklmnopqrstuvwxyz12";
const REGISTRY={"ynx-social-v1":{requestingProduct:"social",bundleId:"com.ynx.social",callbacks:["ynx-social://com.ynx.social"],scopes:["account:read","profile:link"],maxScopes:2}};

test("Social API36 request is produced only by the shared canonical builder",()=>{const generated=generateCanonicalSocialAuthorization(DEVICE_KEY,{now:NOW,nonce:NONCE});assert.equal(generated.authorizeURL,encodeRequestDeepLink(generated.request));const parsed=parseWalletDeepLink(generated.authorizeURL,"android",{now:NOW,registry:REGISTRY});assert.equal(parsed.request.productDeviceKey,DEVICE_KEY);assert.equal(parsed.request.callback,"ynx-social://com.ynx.social");assert.deepEqual(parsed.request.scopes,["account:read","profile:link"])});
test("Social API36 generator rejects invalid public keys, time and nonce",()=>{assert.throws(()=>generateCanonicalSocialAuthorization("not-a-key",{now:NOW,nonce:NONCE}),/public key/);assert.throws(()=>generateCanonicalSocialAuthorization(DEVICE_KEY,{now:new Date(Number.NaN),nonce:NONCE}),/time/);assert.throws(()=>generateCanonicalSocialAuthorization(DEVICE_KEY,{now:NOW,nonce:"short"}),/nonce/)});
