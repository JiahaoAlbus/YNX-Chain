import { createHostedWalletAdapter } from "../src/hosted-adapter.js";
import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_CHAIN_ID, HOSTED_PROTOCOL, assertHostedMethodAllowed, encodeHostedConnect, hostedEnvelope, parseHostedConnect, randomHostedId, registeredProduct, validateHostedMessage } from "../src/hosted-protocol.js";

const now = Date.now();
function request(origin = "https://finance.ynxweb4.com") { return { version: 1, origin, requestId: randomHostedId(), nonce: randomHostedId(), expiresAt: now + 90_000, chainId: HOSTED_CHAIN_ID }; }

test("only a reviewed Finance origin opens an exact bounded hosted connect request", () => {
  const value = request();
  assert.equal(registeredProduct(value.origin)?.productId, "finance");
  assert.deepEqual(parseHostedConnect(encodeHostedConnect(value), now), value);
  assert.throws(() => parseHostedConnect(encodeHostedConnect(request("https://evil.example")), now));
  assert.throws(() => parseHostedConnect(encodeHostedConnect({ ...value, expiresAt: now + 300_000 }), now));
  assert.throws(() => parseHostedConnect(encodeHostedConnect({ ...value, extra: "ignored?" }), now));
});

test("opener source, origin, nonce, expiry and one-use message ID all bind the same channel", () => {
  const value = request(), opener = {}, seen = new Set();
  const message = hostedEnvelope(value, "hello", {}, now);
  assert.equal(message.protocol, HOSTED_PROTOCOL);
  assert.equal(validateHostedMessage({ source: opener, origin: value.origin, data: message }, opener, value, seen, now).type, "hello");
  assert.throws(() => validateHostedMessage({ source: opener, origin: value.origin, data: message }, opener, value, seen, now));
  assert.throws(() => validateHostedMessage({ source: {}, origin: value.origin, data: { ...message, messageId: randomHostedId() } }, opener, value, new Set(), now));
  assert.throws(() => validateHostedMessage({ source: opener, origin: "https://evil.example", data: { ...message, messageId: randomHostedId() } }, opener, value, new Set(), now));
  assert.throws(() => validateHostedMessage({ source: opener, origin: value.origin, data: { ...message, nonce: randomHostedId(), messageId: randomHostedId() } }, opener, value, new Set(), now));
  assert.throws(() => validateHostedMessage({ source: opener, origin: value.origin, data: { ...message, expiresAt: now, messageId: randomHostedId() } }, opener, value, new Set(), now));
});

 test("first-party Social transport preserves its native-only registry and private-request boundary", () => {
 const origin="https://social.ynxweb4.com",value=request(origin),product=registeredProduct(origin);
 assert.equal(product.productId,"social");assert.equal(product.clientId,"ynx-social-v1");assert.equal(product.evmCompatible,false);
 assert.deepEqual(parseHostedConnect(encodeHostedConnect(value),now),value);
 for(const method of ["eth_requestAccounts","eth_accounts","eth_chainId","ynx_requestProductSessionV2","wallet_disconnect","wallet_revokePermissions"])assert.doesNotThrow(()=>assertHostedMethodAllowed(origin,method));
 for(const method of ["personal_sign","eth_sendTransaction","ynx_requestCentralBrowserSignIn"])assert.throws(()=>assertHostedMethodAllowed(origin,method),/HOSTED_SOCIAL_PRIVATE_ONLY/);
 for(const bad of ["https://social.ynxweb4.com.evil.example","https://www.social.ynxweb4.com","http://social.ynxweb4.com"])assert.throws(()=>parseHostedConnect(encodeHostedConnect(request(bad)),now));
 const opener={},message=hostedEnvelope(value,"hello",{},now);assert.throws(()=>validateHostedMessage({source:opener,origin:"https://finance.ynxweb4.com",data:message},opener,value,new Set(),now));
 assert.throws(()=>validateHostedMessage({source:opener,origin,data:message},opener,{...value,nonce:randomHostedId()},new Set(),now));
 });

 test("first-party AI transport preserves its native-only registry and private-request boundary", () => {
 const origin="https://assistant.ynxweb4.com",value=request(origin),product=registeredProduct(origin);
 assert.equal(product.productId,"ai");assert.equal(product.clientId,"ynx-ai-v1");assert.equal(product.evmCompatible,false);
 assert.deepEqual(parseHostedConnect(encodeHostedConnect(value),now),value);
 for(const method of ["eth_requestAccounts","eth_accounts","eth_chainId","ynx_requestProductSessionV2","wallet_disconnect","wallet_revokePermissions"])assert.doesNotThrow(()=>assertHostedMethodAllowed(origin,method));
 for(const method of ["personal_sign","eth_sendTransaction","ynx_requestCentralBrowserSignIn"])assert.throws(()=>assertHostedMethodAllowed(origin,method),/HOSTED_AI_PRIVATE_ONLY/);
 for(const bad of ["https://assistant.ynxweb4.com.evil.example","https://www.assistant.ynxweb4.com","http://assistant.ynxweb4.com"])assert.throws(()=>parseHostedConnect(encodeHostedConnect(request(bad)),now));
 const opener={},message=hostedEnvelope(value,"hello",{},now);assert.throws(()=>validateHostedMessage({source:opener,origin:"https://finance.ynxweb4.com",data:message},opener,value,new Set(),now));
 assert.throws(()=>validateHostedMessage({source:opener,origin,data:message},opener,{...value,nonce:randomHostedId()},new Set(),now));
 });

test("actual AI Hosted adapter accepts only the registered HTTPS origin",()=>{assert.doesNotThrow(()=>createHostedWalletAdapter({window:{location:{origin:"https://assistant.ynxweb4.com"},addEventListener(){}}}));for(const origin of ["https://assistant.ynxweb4.com.evil.example","http://assistant.ynxweb4.com","https://www.assistant.ynxweb4.com"])assert.throws(()=>createHostedWalletAdapter({window:{location:{origin}}}),/HOSTED_ORIGIN_UNREGISTERED/);});

for(const [origin,productId,clientId] of [['https://video.ynxweb4.com','video','ynx-video-mobile-v1'],['https://creator.ynxweb4.com','creator-studio','ynx-creator-studio-web-v1']])test('native private Hosted exact tuple: '+productId,()=>{const product=registeredProduct(origin);assert.equal(product?.productId,productId);assert.equal(product.clientId,clientId);assert.equal(product.evmCompatible,false);assert.doesNotThrow(()=>createHostedWalletAdapter({window:{location:{origin},addEventListener(){}}}));const value=request(origin);assert.deepEqual(parseHostedConnect(encodeHostedConnect(value),now),value);for(const method of ['ynx_requestProductSessionV2','eth_requestAccounts','eth_accounts','eth_chainId','wallet_disconnect','wallet_revokePermissions'])assert.doesNotThrow(()=>assertHostedMethodAllowed(origin,method));for(const method of ['personal_sign','ynx_requestCentralBrowserSignIn','eth_sendTransaction'])assert.throws(()=>assertHostedMethodAllowed(origin,method),{code:'HOSTED_NATIVE_PRIVATE_ONLY'});for(const bad of [origin+'.evil.example',origin.replace('https:','http:'),origin.replace('https://','https://www.')])assert.throws(()=>createHostedWalletAdapter({window:{location:{origin:bad}}}),{code:'HOSTED_ORIGIN_UNREGISTERED'});const opener={},message=hostedEnvelope(value,'hello',{},now);assert.throws(()=>validateHostedMessage({source:{},origin,data:message},opener,value,new Set(),now));assert.throws(()=>validateHostedMessage({source:opener,origin:'https://finance.ynxweb4.com',data:message},opener,value,new Set(),now));assert.throws(()=>validateHostedMessage({source:opener,origin,data:message},opener,{...value,nonce:randomHostedId()},new Set(),now));});
