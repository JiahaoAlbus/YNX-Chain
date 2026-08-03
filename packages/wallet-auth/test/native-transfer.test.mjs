import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSignedNativeTransfer,evmAddressFromYNX,nativeTransferHash,parseSignedNativeTransfer,WalletAuthError,ynxAddressFromEVM} from "../src/index.js";

const vector=JSON.parse(readFileSync(new URL("../testdata/mobile-native-transfer-v1.json",import.meta.url),"utf8"));

test("JS Wallet emits the exact Go-verified native transfer vector",()=>{
  const to=ynxAddressFromEVM(vector.toEVM);
  assert.equal(evmAddressFromYNX(to),vector.toEVM);
  const signed=createSignedNativeTransfer({accountSecret:vector.accountSecret,to,amount:vector.amount,nonce:vector.nonce});
  assert.equal(signed.payload,vector.payload);
  assert.equal(signed.hash,vector.hash);
  assert.equal(nativeTransferHash(vector.payload),vector.hash);
  assert.deepEqual(parseSignedNativeTransfer(vector.payload),signed.transaction);
});

test("native transfer rejects account, field, canonical JSON and signature tamper",()=>{
  assert.throws(()=>evmAddressFromYNX("ynx1tampered"),code("INVALID_ACCOUNT"));
  const tx=JSON.parse(vector.payload);
  assert.throws(()=>parseSignedNativeTransfer({...tx,amount:26}),code("INVALID_TRANSFER_SIGNATURE"));
  assert.throws(()=>parseSignedNativeTransfer({...tx,extra:true}),code("UNKNOWN_OR_MISSING_FIELD"));
  assert.throws(()=>parseSignedNativeTransfer(`${vector.payload}\n`),code("INVALID_TRANSFER"));
});

function code(expected){return(error)=>error instanceof WalletAuthError&&error.code===expected}
