import assert from "node:assert/strict";
import {test} from "node:test";
import {DEFAULT_CHAIN_API,LEGACY_CHAIN_API,nativeChainClientForStoredOrigin} from "./nativeTransfer";
test("recovery accepts only exact approved original profiles without dispatch",()=>{
  let calls=0;const fetcher=async()=>{calls++;throw Error("no network")};
  for(const origin of [DEFAULT_CHAIN_API,LEGACY_CHAIN_API,"http://127.0.0.1:9999"])assert.equal(nativeChainClientForStoredOrigin(origin,"http://127.0.0.1:9999",fetcher).origin,origin);
  for(const origin of ["https://unapproved.example",DEFAULT_CHAIN_API+"/",DEFAULT_CHAIN_API+"?x=1"])assert.throws(()=>nativeChainClientForStoredOrigin(origin,undefined,fetcher),/approved/);
  assert.equal(calls,0);
});
