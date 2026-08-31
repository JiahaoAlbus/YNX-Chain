import assert from "node:assert/strict";
import test from "node:test";
import { resolveExecutable } from "../../workspace-agent/src/sandbox.mjs";
import { runCppLanguageRequest } from "../src/cpp-lsp.mjs";
import { runPythonLanguageRequest } from "../src/python-lsp.mjs";
import { runTypescriptLanguageRequest } from "../src/typescript-lsp.mjs";

const ready = await Promise.all([resolveExecutable(["clangd","clangd-18"]),resolveExecutable(["pyright-langserver"]),resolveExecutable(["typescript-language-server"])]);

test("bounded LSP capacity queues concurrent tenant requests in one gateway process",{skip:ready.some(value=>!value)},async()=>{
  const jobs=[
    ()=>runCppLanguageRequest({files:{"main.cpp":"int add(int a,int b){return a+b;}\nint main(){return ad;}\n"},activePath:"main.cpp",operation:"completion",position:{line:1,character:20}}),
    ()=>runTypescriptLanguageRequest({files:{"main.ts":"function add(a:number,b:number){return a+b}\nad\n"},activePath:"main.ts",operation:"completion",position:{line:1,character:2}}),
    ()=>runPythonLanguageRequest({files:{"main.py":"def add(a: int,b: int)->int: return a+b\nad\n"},activePath:"main.py",operation:"completion",position:{line:1,character:2}}),
  ];
  const values=await Promise.all([...jobs,...jobs].map(job=>job()));
  assert.deepEqual(values.map(value=>value.language).sort(),["cpp","cpp","python","python","typescript","typescript"]);
  assert.ok(values.every(value=>value.sandbox.network===false));
});
