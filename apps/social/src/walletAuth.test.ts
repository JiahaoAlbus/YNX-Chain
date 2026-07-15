import assert from "node:assert/strict";
import test from "node:test";
import { CALLBACK, CLIENT_ID, SCOPES, parseWalletCallback, walletRequestURL } from "./walletAuth";

const now = new Date("2026-07-15T12:00:00.000Z");
const devicePublicKey="A".repeat(43);
const encryptionPublicKey="B".repeat(43);
function callback(overrides: Record<string, unknown> = {}) { const assertion = { account:"ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqz7fll8", publicKey:`02${"11".repeat(32)}`, deviceId:"device-social-1", deviceSigningPublicKey:devicePublicKey,deviceEncryptionPublicKey:encryptionPublicKey, clientId:CLIENT_ID, callback:CALLBACK, scopes:[...SCOPES], nonce:"nonce-social-1", issuedAt:"2026-07-15T11:59:59.000Z", expiresAt:"2026-07-15T12:04:00.000Z", signature:"304401", ...overrides }; return `${CALLBACK}?assertion=${Buffer.from(JSON.stringify(assertion)).toString("base64url")}`; }
test("builds least privilege Wallet request",()=>{const value=walletRequestURL("nonce-social-1","device-social-1",devicePublicKey,encryptionPublicKey);assert.match(value,/ynxwallet:\/\/authorize/);assert.match(value,/No\+recovery\+key/)});
test("parses exact callback and rejects substitution",()=>{assert.equal(parseWalletCallback(callback(),"nonce-social-1","device-social-1",devicePublicKey,encryptionPublicKey,now).clientId,CLIENT_ID);assert.throws(()=>parseWalletCallback(callback({callback:"ynxsocial://evil"}),"nonce-social-1","device-social-1",devicePublicKey,encryptionPublicKey,now),/binding/);assert.throws(()=>parseWalletCallback(callback({expiresAt:"2026-07-15T13:00:00.000Z"}),"nonce-social-1","device-social-1",devicePublicKey,encryptionPublicKey,now),/stale/)});
