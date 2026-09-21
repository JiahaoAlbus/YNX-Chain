import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const source=readFileSync(new URL("../../App.tsx",import.meta.url),"utf8");

test("opening Send reconciles the stored original with public reads before offering recovery actions",()=>{
  assert.match(source,/nativeOutbox\.read\(account\.account\)[\s\S]{0,900}nativeOutbox\.recover\(account\.account,storedChainClient\(value\.origin\),activeLease\.assert\)/);
  assert.match(source,/stored&&mode!=="new"\?storedChainClient\(stored\.origin\):chainClient\(\)/);
  assert.match(source,/value\.phase!=="done"/);
  assert.match(source,/recovered\?\.phase==="done"/);
});

test("a durable result unlocks the same Send surface without a manual Done gate",()=>{
  const action=source.slice(source.indexOf('const act=async(mode:"new"'),source.indexOf('const problem=error?',source.indexOf('const act=async(mode:"new"')));
  assert.doesNotMatch(action,/mode:"done"|mode==="done"|nativeOutbox\.acknowledge/);
  assert.match(action,/result\.phase==="done"\)\{cancelInput\(\);setTo\(""\);setAmount\(""\);setReview\(false\)\}/);
  assert.doesNotMatch(source,/Done acknowledges this result before another transfer can be signed|label="Done"/);
});
