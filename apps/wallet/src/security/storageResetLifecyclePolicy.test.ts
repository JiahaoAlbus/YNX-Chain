import assert from "node:assert/strict";
import { test } from "node:test";
import { assertStorageResetActive, type StorageResetCurrent } from "./storageResetLifecyclePolicy";

const active:StorageResetCurrent={epoch:7,appState:"active",privacyReady:true,manifestPresent:false,storageErrorPresent:true};

test("unreadable-storage reset requires its exact active privacy epoch",()=>{
  assert.doesNotThrow(()=>assertStorageResetActive({epoch:7},active));
  for(const [change,error] of [
    [{epoch:8},/lock or privacy/],
    [{appState:"background"},/background/],
    [{privacyReady:false},/screenshot protection/],
    [{manifestPresent:true},/unreadable storage/],
    [{storageErrorPresent:false},/unreadable storage/],
  ] as const)assert.throws(()=>assertStorageResetActive({epoch:7},{...active,...change}),error);
});
