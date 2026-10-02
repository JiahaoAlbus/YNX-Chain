import assert from "node:assert/strict";
import test from "node:test";
import {SocialWorkspace} from "../web/chat-workspace";
import {SocialAPI} from "./api";
import {DurableOutbox} from "./durableOutbox";

// Controller-only synthetic state; not a real consent or installed E2EE receipt.
function fixture(){
  const sent:unknown[][]=[];let fail=false;
  const api=new SocialAPI("http://127.0.0.1:6431");
  api.previewContact=async()=>({person:{id:"target-stable-id",handle:"bob",displayName:"Bob"}});
  api.requestContact=async(...args)=>{sent.push(args);if(fail)throw new Error("temporary network failure");return {}};
  const workspace=new SocialWorkspace({} as never,api,{} as never,new DurableOutbox({read:()=>null,write:()=>{},remove:()=>{}}),async()=>({account:"actor",csrfToken:"synthetic"}),()=>{},bytes=>bytes.fill(4));
  Object.assign(workspace,{session:{session:{account:"actor"}},device:{},view:{account:"actor",profile:{id:"actor",handle:"alice",displayName:"Alice"}}});
  workspace.refresh=async()=>{};
  return {workspace,api,sent,setFail:(value:boolean)=>{fail=value}};
}

test("preview alone sends nothing; explicit confirmation binds reviewed identity",async()=>{
  const {workspace,sent}=fixture();const preview=await workspace.previewContact("handle"," @bob ");assert.equal(sent.length,0);
  await assert.rejects(workspace.requestContact("bob"),/explicitly confirm/);
  await workspace.confirmContact(preview);assert.deepEqual(sent[0],["handle","bob",preview.idempotencyKey,"target-stable-id"]);
  await assert.rejects(workspace.confirmContact(preview),/review again/);assert.equal(sent.length,1);
});
test("cancel and account lock invalidate previous review",async()=>{
  const {workspace,sent}=fixture();const cancelled=await workspace.previewContact("handle","bob");workspace.cancelContactPreview(cancelled);
  await assert.rejects(workspace.confirmContact(cancelled),/review again/);
  const old=await workspace.previewContact("handle","bob");workspace.lock();assert.equal(workspace.isContactPreviewCurrent(old),false);
  await assert.rejects(workspace.confirmContact(old));assert.equal(sent.length,0);
});
test("new preview invalidates old and failed submission retains exact retry identity",async()=>{
  const {workspace,sent,setFail}=fixture();const old=await workspace.previewContact("handle","bob"),current=await workspace.previewContact("qr","synthetic-qr");
  await assert.rejects(workspace.confirmContact(old),/review again/);setFail(true);await assert.rejects(workspace.confirmContact(current),/temporary/);
  setFail(false);await workspace.confirmContact(current);assert.deepEqual(sent[0],sent[1]);assert.equal(sent.length,2);
});
test("late preview after logout is discarded without submitting",async()=>{
  const {workspace,api,sent}=fixture();let finish!:(result:any)=>void;api.previewContact=()=>new Promise(resolve=>{finish=resolve});
  const pending=workspace.previewContact("handle","bob");workspace.lock();finish({person:{id:"target",handle:"bob",displayName:"Bob"}});
  await assert.rejects(pending,/review again/);assert.equal(sent.length,0);
});
test("invitation links are parsed in place and foreign routes fail closed",async()=>{
  const {workspace,sent}=fixture();const preview=await workspace.previewContact("invite","https://social.ynxweb4.com/invite/synthetic-token");
  assert.equal(preview.value,"synthetic-token");await workspace.confirmContact(preview);assert.equal(sent[0]![0],"invite");
  await assert.rejects(workspace.previewContact("invite","https://example.invalid/invite/token"),/exact YNX/);
});
