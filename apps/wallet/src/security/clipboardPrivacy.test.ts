import assert from "node:assert/strict";
import { test } from "node:test";
import { copyPublicValueWithExpiry, type ClipboardSchedule } from "./clipboardPrivacy";

class MemoryClipboard {
  value = "";
  readonly writes: string[] = [];
  async getStringAsync() { return this.value; }
  async setStringAsync(value: string) { this.value = value; this.writes.push(value); }
}

function controlledSchedule() {
  let task: (() => void | Promise<void>) | null = null;
  let cancelled = false;
  const schedule: ClipboardSchedule = (next) => {
    task = next;
    return Object.freeze({ cancel: () => { cancelled = true; } });
  };
  return {
    schedule,
    run: async () => { if (!cancelled && task) await task(); },
  };
}

test("public address clipboard copy clears only the unchanged Wallet value", async () => {
  const clipboard = new MemoryClipboard();
  const timer = controlledSchedule();
  await copyPublicValueWithExpiry(clipboard, "ynx1publicaddress", { ttlMs: 1_000, schedule: timer.schedule });
  assert.equal(clipboard.value, "ynx1publicaddress");
  await timer.run();
  assert.equal(clipboard.value, "");
  assert.deepEqual(clipboard.writes, ["ynx1publicaddress", ""]);
});

test("clipboard expiry never erases a value copied later by the user", async () => {
  const clipboard = new MemoryClipboard();
  const timer = controlledSchedule();
  await copyPublicValueWithExpiry(clipboard, "ynx1publicaddress", { ttlMs: 1_000, schedule: timer.schedule });
  clipboard.value = "user-copied-later";
  await timer.run();
  assert.equal(clipboard.value, "user-copied-later");
  assert.deepEqual(clipboard.writes, ["ynx1publicaddress"]);
});

test("cancelled clipboard expiry performs no later mutation", async () => {
  const clipboard = new MemoryClipboard();
  const timer = controlledSchedule();
  const cancel = await copyPublicValueWithExpiry(clipboard, "ynx1publicaddress", { ttlMs: 1_000, schedule: timer.schedule });
  cancel();
  await timer.run();
  assert.equal(clipboard.value, "ynx1publicaddress");
});

test("clipboard policy rejects whitespace and unbounded retention", async () => {
  const clipboard = new MemoryClipboard();
  await assert.rejects(copyPublicValueWithExpiry(clipboard, " ynx1 "), /invalid/);
  await assert.rejects(copyPublicValueWithExpiry(clipboard, "ynx1", { ttlMs: 999 }), /between/);
  await assert.rejects(copyPublicValueWithExpiry(clipboard, "ynx1", { ttlMs: 120_001 }), /between/);
});

test("reopening Receive and copying the same public link starts a new complete expiry interval",async()=>{
  const clipboard=new MemoryClipboard(),first=controlledSchedule(),latest=controlledSchedule();
  const oldCancel=await copyPublicValueWithExpiry(clipboard,"ynx:public-receiving-link",{schedule:first.schedule});
  await copyPublicValueWithExpiry(clipboard,"ynx:public-receiving-link",{schedule:latest.schedule});
  await first.run();assert.equal(clipboard.value,"ynx:public-receiving-link","an earlier modal must not clear the new copy");
  oldCancel();await latest.run();assert.equal(clipboard.value,"");
});

test("an expiry already reading clipboard cannot erase a later successful Wallet copy",async()=>{
  const clipboard=new MemoryClipboard(),first=controlledSchedule(),latest=controlledSchedule();
  let resolve!:(value:string)=>void;const pending=new Promise<string>(done=>resolve=done),get=clipboard.getStringAsync.bind(clipboard);
  await copyPublicValueWithExpiry(clipboard,"ynx:public-link",{schedule:first.schedule});
  clipboard.getStringAsync=()=>pending;const expiry=first.run();
  await copyPublicValueWithExpiry(clipboard,"ynx:public-link",{schedule:latest.schedule});
  resolve("ynx:public-link");await expiry;assert.equal(clipboard.value,"ynx:public-link");
  clipboard.getStringAsync=get;await latest.run();assert.equal(clipboard.value,"");
});

test("cancelling an expiry during its asynchronous read prevents its clearing write",async()=>{
  const clipboard=new MemoryClipboard(),timer=controlledSchedule();let resolve!:(value:string)=>void;
  const cancel=await copyPublicValueWithExpiry(clipboard,"ynx:public-link",{schedule:timer.schedule});
  clipboard.getStringAsync=()=>new Promise<string>(done=>resolve=done);
  const expiry=timer.run();cancel();resolve("ynx:public-link");await expiry;
  assert.deepEqual(clipboard.writes,["ynx:public-link"]);
});

test("invalid or failed replacement does not discard the prior successful copy expiry",async()=>{
  const clipboard=new MemoryClipboard(),timer=controlledSchedule(),set=clipboard.setStringAsync.bind(clipboard);
  await copyPublicValueWithExpiry(clipboard,"ynx:public-link",{schedule:timer.schedule});
  await assert.rejects(()=>copyPublicValueWithExpiry(clipboard," invalid"),/invalid/);
  clipboard.setStringAsync=async()=>{throw new Error("permission denied")};
  await assert.rejects(()=>copyPublicValueWithExpiry(clipboard,"ynx:replacement"),/permission denied/);
  clipboard.setStringAsync=set;await timer.run();assert.equal(clipboard.value,"");
});

test("independent clipboard adapters keep independent expiry leases",async()=>{
  const a=new MemoryClipboard(),b=new MemoryClipboard(),first=controlledSchedule(),second=controlledSchedule();
  await copyPublicValueWithExpiry(a,"ynx:public-a",{schedule:first.schedule});
  await copyPublicValueWithExpiry(b,"ynx:public-b",{schedule:second.schedule});
  await first.run();assert.equal(a.value,"");assert.equal(b.value,"ynx:public-b");
  await second.run();assert.equal(b.value,"");
});

test("a clearing write already inside the OS finishes before the next Wallet copy",async()=>{
  const clipboard=new MemoryClipboard(),first=controlledSchedule(),latest=controlledSchedule(),set=clipboard.setStringAsync.bind(clipboard);
  let beginClear!:()=>void,finishClear!:()=>void;
  const entered=new Promise<void>(done=>beginClear=done),completion=new Promise<void>(done=>finishClear=done);
  clipboard.setStringAsync=async value=>{if(value===""){beginClear();await completion}await set(value)};
  await copyPublicValueWithExpiry(clipboard,"ynx:old-link",{schedule:first.schedule});
  const expiry=first.run();await entered;
  const newer=copyPublicValueWithExpiry(clipboard,"ynx:new-link",{schedule:latest.schedule});
  finishClear();await Promise.all([expiry,newer]);
  assert.deepEqual(clipboard.writes,["ynx:old-link","","ynx:new-link"]);assert.equal(clipboard.value,"ynx:new-link");
  await latest.run();assert.equal(clipboard.value,"");
});

test("a failed in-flight OS clear does not poison the following copy or its expiry",async()=>{
  const clipboard=new MemoryClipboard(),first=controlledSchedule(),latest=controlledSchedule(),set=clipboard.setStringAsync.bind(clipboard);
  let entered!:()=>void,release!:()=>void;const started=new Promise<void>(done=>entered=done),finish=new Promise<void>(done=>release=done);let fail=true;
  clipboard.setStringAsync=async value=>{if(value===""&&fail){entered();await finish;throw new Error("OS rejected clear")}await set(value)};
  await copyPublicValueWithExpiry(clipboard,"ynx:old-link",{schedule:first.schedule});const expiry=first.run();await started;
  const newer=copyPublicValueWithExpiry(clipboard,"ynx:new-link",{schedule:latest.schedule});release();await Promise.all([expiry,newer]);
  assert.equal(clipboard.value,"ynx:new-link");fail=false;await latest.run();assert.equal(clipboard.value,"");
});

test("an older expiry queued while a new copy write awaits cannot clear the new value",async()=>{
  const clipboard=new MemoryClipboard(),first=controlledSchedule(),latest=controlledSchedule(),set=clipboard.setStringAsync.bind(clipboard);
  let entered!:()=>void,release!:()=>void;const started=new Promise<void>(done=>entered=done),finish=new Promise<void>(done=>release=done);
  await copyPublicValueWithExpiry(clipboard,"ynx:old-link",{schedule:first.schedule});
  clipboard.setStringAsync=async value=>{if(value==="ynx:new-link"){entered();await finish}await set(value)};
  const newer=copyPublicValueWithExpiry(clipboard,"ynx:new-link",{schedule:latest.schedule});await started;
  const expiry=first.run();release();await Promise.all([newer,expiry]);assert.equal(clipboard.value,"ynx:new-link");
  assert.deepEqual(clipboard.writes,["ynx:old-link","ynx:new-link"]);
});
