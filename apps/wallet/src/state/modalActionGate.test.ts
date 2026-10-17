import {test} from "node:test";
import assert from "node:assert/strict";
import {ModalActionGate} from "./modalActionGate";
test("modal action ownership is synchronous and single use",()=>{
  const gate=new ModalActionGate(),first=gate.acquire()!;
  assert.equal(gate.acquire(),null);assert.equal(first.finish(),true);
  const next=gate.acquire()!;assert.equal(first.finish(),false);assert.equal(next.isCurrent(),true);
});
test("closing fences old handlers and reopening fences old completions",()=>{
  const gate=new ModalActionGate(),old=gate.acquire()!;gate.close();
  assert.equal(old.isCurrent(),false);assert.equal(gate.acquire(),null);
  gate.open();const next=gate.acquire()!;assert.equal(old.finish(),false);
  assert.equal(next.isCurrent(),true);assert.equal(gate.acquire(),null);
});
