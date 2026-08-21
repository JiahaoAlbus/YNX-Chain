import assert from "node:assert/strict";
import test from "node:test";
import {launchAIWalletAuthorization} from "./nativeWalletLaunch";
import {createCanonicalAuthorizeLaunch,type AuthorizationRequest} from "@ynx-chain/wallet-auth";

const request={version:"2",nonce:"nonce_abcdefghijklmnopqrstuvwxyz",chainId:"ynx_6423-1",requestingProduct:"ai",productClientId:"ynx-ai-v1",bundleId:"com.ynxweb4.ai",productDeviceAlgorithm:"p256-sha256",productDeviceKey:"AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",origin:"https://ai.ynxweb4.com",callback:"ynxai://wallet-auth/callback",scopes:["account:read"],purpose:"Sign in to YNX AI",issuedAt:"2026-08-21T05:00:00.000Z",expiresAt:"2026-08-21T05:05:00.000Z"} as AuthorizationRequest;
const walletUrl=createCanonicalAuthorizeLaunch(request).uri;

test("installed handler opens the exact canonical request once",async()=>{const opened:string[]=[];const result=await launchAIWalletAuthorization({request,walletUrl},"android",{canOpenURL:async url=>url===walletUrl,openURL:async url=>{opened.push(url)}});assert.equal(result.status,"installed");assert.deepEqual(opened,[walletUrl])});
test("missing handler keeps the app available and returns official recovery choices",async()=>{let opened=false;const result=await launchAIWalletAuthorization({request,walletUrl},"ios",{canOpenURL:async()=>false,openURL:async()=>{opened=true}});assert.equal(result.status,"unsupported");assert.equal(opened,false);assert.deepEqual(result.fallbackActions.map(action=>[action.label,action.url]),[["Download YNX Wallet","https://www.ynxweb4.com/dapp/download"],["Use MetaMask","https://metamask.io/download/"]])});
test("server URL substitution fails before native resolution",async()=>{let resolved=false;await assert.rejects(()=>launchAIWalletAuthorization({request,walletUrl:"ynxwallet://authorize?request=substituted"},"android",{canOpenURL:async()=>{resolved=true;return true},openURL:async()=>{}}),/does not match/);assert.equal(resolved,false)});
