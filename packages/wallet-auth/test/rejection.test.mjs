import assert from "node:assert/strict";
import test from "node:test";
import { createAuthorizationRejection, createCallbackURL, parseAuthorizationRequest, parseCallbackURL, verifyAuthorizationRejection } from "../src/index.js";

const NOW=new Date("2026-07-15T12:00:00.000Z");
const REGISTRY={"ynx-social-v1":{requestingProduct:"social",bundleId:"com.ynx.social",callbacks:["ynx-social://com.ynx.social"],scopes:["account:read"]}};
const request=parseAuthorizationRequest({version:"1",nonce:"nonce_abcdefghijklmnopqrstuvwxyz12",chainId:"ynx_6423-1",requestingProduct:"social",productClientId:"ynx-social-v1",bundleId:"com.ynx.social",productDeviceAlgorithm:"p256-sha256",productDeviceKey:"AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",callback:"ynx-social://com.ynx.social",scopes:["account:read"],purpose:"Sign in",issuedAt:"2026-07-15T11:59:00.000Z",expiresAt:"2026-07-15T12:04:00.000Z"},{now:NOW,registry:REGISTRY});

test("canonical rejection callback is request-bound and grants zero authority",()=>{const rejection=createAuthorizationRejection(request,{decisionCode:"USER_REJECTED",rejectedAt:NOW.toISOString()}),callback=createCallbackURL(rejection);const parsed=parseCallbackURL(callback,request.callback),verified=verifyAuthorizationRejection(parsed,request,NOW);assert.equal(verified.authorityGranted,false);assert.deepEqual(verified.grantedScopes,[]);assert.equal(verified.decisionCode,"USER_REJECTED")});
test("rejection fails closed for authority, scope, and request drift",()=>{const rejection=createAuthorizationRejection(request,{decisionCode:"USER_REJECTED",rejectedAt:NOW.toISOString()});assert.throws(()=>verifyAuthorizationRejection({...rejection,authorityGranted:true},request,NOW),/authority or scopes/);assert.throws(()=>verifyAuthorizationRejection({...rejection,grantedScopes:["account:read"]},request,NOW),/authority or scopes/);assert.throws(()=>verifyAuthorizationRejection({...rejection,nonce:"other_nonce_abcdefghijklmnopqrstuvwxyz"},request,NOW),/does not match/)});
