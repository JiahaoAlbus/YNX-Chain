import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const source=readFileSync(new URL("../../App.tsx",import.meta.url),"utf8");

test("opening Send reconciles the stored original with public reads before offering recovery actions",()=>{
  assert.match(source,/nativeOutbox\.read\(account\.account\)[\s\S]{0,900}nativeOutbox\.recover\(account\.account,chainClient\(\),activeLease\.assert\)/);
  assert.match(source,/value\.phase!=="done"&&value\.phase!=="accepted"/);
  assert.match(source,/recovered\?\.phase==="accepted"/);
});

test("acknowledging a durable result unlocks the same Send surface instead of forcing a close and reopen",()=>{
  const action=source.slice(source.indexOf('const act=async(mode:"new"'),source.indexOf('const problem=error?',source.indexOf('const act=async(mode:"new"')));
  assert.match(action,/mode==="done"\)\{cancelInput\(\);setTo\(""\);setAmount\(""\);setReview\(false\)\}/);
  assert.doesNotMatch(action,/mode==="done"\)dismiss\(\)/);
});
