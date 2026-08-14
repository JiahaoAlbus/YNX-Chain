import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("recovery-key input opts out of Android Autofill and text-learning surfaces",async()=>{
  const source=await readFile(new URL("../../App.tsx",import.meta.url),"utf8");
  assert.ok(source.includes('<Field label="Recovery key"'));
  assert.ok(source.includes("secure multiline"));
  for(const required of [
    'secureTextEntry={secure}',
    'autoComplete={secure?"off":undefined}',
    'importantForAutofill={secure?"noExcludeDescendants":"auto"}',
    'textContentType={secure?"none":undefined}',
    'spellCheck={!secure}',
  ])assert.ok(source.includes(required),`secure Wallet inputs must enforce ${required}`);
});
