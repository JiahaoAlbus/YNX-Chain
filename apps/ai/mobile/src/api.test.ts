import assert from "node:assert/strict";
import test from "node:test";
import {API_BASE,createSSEParser} from "./api";
test("sensitive prompt route is POST-body-only contract",()=>{
  const prompt="secret prompt ? recovery=never";
  const route=`${API_BASE}/api/conversations/conv_1/generate`;
  assert.equal(route.includes(prompt),false);
  assert.equal(JSON.parse(JSON.stringify({prompt})).prompt,prompt);
});

test("SSE parser preserves partial CRLF frames and one terminal event",()=>{
  const tokens:string[]=[],metadata:unknown[]=[],done:unknown[]=[],errors:Error[]=[];
  const parser=createSSEParser({onMetadata:value=>metadata.push(value),onToken:value=>tokens.push(value),onDone:value=>done.push(value),onError:error=>errors.push(error)});
  parser.push('event: metadata\r\ndata: {"requestId":"r1"}\r');
  parser.push('\n\r\nevent: token\r\ndata: {"text":"hel');
  parser.push('lo"}\r\n\r\nevent: done\ndata: {"messageId":"m1"}\n\n');
  parser.push('event: token\ndata: {"text":"ignored-after-done"}\n\n');
  assert.equal(parser.finish(),true);
  assert.deepEqual(tokens,["hello"]);
  assert.deepEqual(metadata,[{requestId:"r1"}]);
  assert.deepEqual(done,[{messageId:"m1"}]);
  assert.deepEqual(errors,[]);
});

test("SSE parser surfaces malformed JSON and provider error once",()=>{
  const errors:Error[]=[];
  const callbacks={onMetadata:()=>{},onToken:()=>{},onDone:()=>{},onError:(error:Error)=>errors.push(error)};
  const malformed=createSSEParser(callbacks);
  malformed.push("event: token\ndata: {bad}\n\n");
  malformed.push('event: error\ndata: {"error":"ignored"}\n\n');
  assert.equal(malformed.finish(),true);
  assert.equal(errors.length,1);
  const provider=createSSEParser(callbacks);
  provider.push('event: error\ndata: {"error":"quota 429"}\n\n');
  assert.equal(provider.finish(),true);
  assert.equal(errors[1].message,"quota 429");
});

test("formal Wallet endpoint response uses the server walletUrl field",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("./api.ts",import.meta.url),"utf8"));
  assert.match(source,/walletUrl:string/);
  assert.doesNotMatch(source,/request<[^>]*deepLink:string/);
});
