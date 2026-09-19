import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import {extensionReviewText,prepareExtensionRequest} from "../src/extension-signer.js";
import {isProviderInternalRequestId,providerContextLabel} from "../src/extension-provider-permissions.js";
import {toYNXAddress} from "../src/wallet-address.js";
import {NATIVE_FEE_MODEL} from "../src/extension-fee-model.js";
import {DURABILITY_MODEL} from "../src/extension-durability.js";

const ACCOUNT="0x1234567890123456789012345678901234567890",ID=`ynx-scope-v2-${"a".repeat(64)}`;
const html=await readFile(new URL("../extension/signer.html",import.meta.url),"utf8");
const source=(await readFile(new URL("../extension/signer.js",import.meta.url),"utf8")).replace(/^import .*;\n/gm,"");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function personal(message){return prepareExtensionRequest({expectedAccount:ACCOUNT,method:"personal_sign",params:[`0x${Buffer.from(message).toString("hex")}`,ACCOUNT]})}
async function render({summary,method="personal_sign",deadlineAt=2000,requestId=ID,read}={}){
  const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/gu)].map(([,id])=>[id,{
    textContent:"",value:"",disabled:true,hidden:false,open:false,className:"",style:{},handlers:{},
    set innerHTML(_){throw new Error("HTML rendering is forbidden")},
    addEventListener(event,fn){this.handlers[event]=fn},click(){if(!this.disabled)this.handlers.click?.()}
  }]));
  const calls=[],events={},timers=new Map();let now=1000,closed=false,nextTimer=0;
  const context=vm.createContext({extensionReviewText,isProviderInternalRequestId,providerContextLabel,toYNXAddress,URLSearchParams,
    Date:{now:()=>now},location:{search:`?requestId=${requestId}`},document:{querySelector:selector=>nodes.get(selector.slice(1))},
    window:{close:()=>{closed=true}},addEventListener:(name,fn)=>events[name]=fn,
    setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
    chrome:{runtime:{sendMessage:async message=>{calls.push(message);if(message.type==="YNX_SIGNER_GET_V1"){
      if(read)await read();return{ok:true,request:{requestId,origin:"https://dapp.example",account:ACCOUNT,browserContext:"chromium-default",method,summary,deadlineAt}};
    }return{ok:true}}}}
  });
  vm.runInContext(source,context);await tick();
  return{nodes,calls,events,timers,setNow:value=>{now=value},isClosed:()=>closed};
}

test("actual signer renderer safely prioritizes Unicode/HTML message without changing the original summary",async()=>{
  const message='<img src=x onerror="alert(1)">\nline\r\t\u0000\u001b\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b\u200c\u200d\u200e\u200f\u2028\u2029\u202a\u202b\u202c\u202d\u202e\u2060\u2066\u2067\u2068\u2069\u3164\ufeff\uffa0 end';
  const prepared=await personal(message),summary=extensionReviewText(prepared.review),f=await render({summary});
  const preview=f.nodes.get("readable-request").textContent;
  assert.match(preview,/<img src=x onerror=\\"alert\(1\)\\">\\nline\\r\\t\\u0000\\u001b/);
  for(const code of["00ad","034f","061c","115f","1160","17b4","17b5","180e","200b","200c","200d","200e","200f","2028","2029","202a","202b","202c","202d","202e","2060","2066","2067","2068","2069","3164","feff","ffa0"])assert.ok(preview.includes(`\\u${code}`),code);
  assert.doesNotMatch(preview,/[\u0000-\u001f\u00ad\u034f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u);
  assert.equal(f.nodes.get("request").textContent,summary);assert.equal(f.nodes.get("raw-details").open,false);
  assert.equal(f.nodes.get("readable-review").hidden,false);assert.equal(f.nodes.get("review-title").textContent,"Sign message");
  assert.equal(f.nodes.get("account").textContent,toYNXAddress(ACCOUNT));assert.equal(f.calls.length,1);
});

test("maximum-length message and every original hexadecimal byte remain reviewable; empty message is explicit",async()=>{
  const message="a".repeat(4080)+"EXACT FINAL TEXT",prepared=await personal(message),summary=extensionReviewText(prepared.review);
  assert.equal(prepared.review.messageBytes,4096);const f=await render({summary});
  assert.equal(f.nodes.get("readable-request").textContent,message);assert.match(f.nodes.get("review-label").textContent,/4096 bytes/);
  assert.equal(f.nodes.get("request").textContent,summary);assert.ok(summary.includes(prepared.params[0]));
  const empty=await render({summary:extensionReviewText((await personal("")).review)});
  assert.equal(empty.nodes.get("readable-request").textContent,'"" (empty message)');
});

test("typed data retains complete domain/types/message, big integer strings and escaped field values",async()=>{
  const typed={domain:{name:"Domain\u202e<img>",version:"1",chainId:6423,verifyingContract:ACCOUNT},primaryType:"Review",types:{Review:[{name:"note",type:"string"},{name:"amount",type:"uint256"}]},message:{note:"<script>alert(1)</script>\u2066\u200b",amount:"9007199254740993123456789"}};
  const prepared=await prepareExtensionRequest({expectedAccount:ACCOUNT,method:"eth_signTypedData_v4",params:[ACCOUNT,JSON.stringify(typed)]});
  const summary=extensionReviewText(prepared.review),f=await render({method:prepared.method,summary});
  const preview=f.nodes.get("readable-request").textContent;
  assert.equal(preview,summary);assert.equal(f.nodes.get("request").textContent,summary);
  for(const field of['"domain"','"chainId": 6423','"verifyingContract"','"types"','"EIP712Domain"','"primaryType": "Review"','"message"',typed.message.amount,'\\u202e','\\u2066','\\u200b'])assert.ok(preview.includes(field),field);
  assert.equal(f.nodes.get("raw-details").open,false);assert.equal(f.nodes.get("review-title").textContent,"Sign structured data");
});

test("plain, unknown and noncanonical summaries stay fully visible instead of producing a misleading preview",async()=>{
  for(const summary of["Public synthetic legacy message",'{"messageText":"first","messageText":"last"}',
    '{\n  "large": 9007199254740993\n}',extensionReviewText({unknown:"preserve this field"}),"null","[]"]){
    const f=await render({summary});assert.equal(f.nodes.get("request").textContent,summary);
    assert.equal(f.nodes.get("raw-details").open,true);assert.equal(f.nodes.get("readable-review").hidden,true);
    assert.equal(f.nodes.get("approve").disabled,false);assert.equal(f.calls.length,1);
  }
  const unknown=await render({method:"unsupported_method",summary:extensionReviewText({messageText:"Keep complete request"})});
  assert.equal(unknown.nodes.get("review-kind").textContent,"SENSITIVE REQUEST");assert.equal(unknown.nodes.get("review-title").textContent,"Review and unlock");
  assert.doesNotMatch(unknown.nodes.get("review-intro").textContent,/signs/);assert.equal(unknown.nodes.get("raw-details").open,true);
});

test("actual prepared native transfer explicitly reviews signing and sending with full amount and fee budget",async()=>{
  const rpc=async method=>({eth_chainId:"0x1917",ynx_getFeeModel:{...NATIVE_FEE_MODEL,enabled:true},ynx_getDurabilityModel:DURABILITY_MODEL,eth_getTransactionCount:"0x1",eth_estimateGas:"0x61a8",eth_gasPrice:NATIVE_FEE_MODEL.gasPrice,eth_getBalance:`0x${(5n*10n**18n).toString(16)}`})[method];
  const prepared=await prepareExtensionRequest({expectedAccount:ACCOUNT,method:"eth_sendTransaction",params:[{from:ACCOUNT,to:`0x${"2".repeat(40)}`,value:`0x${(2n*10n**18n).toString(16)}`,gas:"0x7530"}],rpc});
  const summary=extensionReviewText(prepared.review),f=await render({method:prepared.method,summary}),raw=f.nodes.get("request").textContent;
  assert.equal(f.nodes.get("review-kind").textContent,"TRANSACTION REQUEST");assert.equal(f.nodes.get("review-title").textContent,"Review transfer");
  assert.match(f.nodes.get("review-intro").textContent,/Approving signs and sends this transaction to YNX Testnet/);
  assert.equal(f.nodes.get("raw-details").open,true);assert.equal(f.nodes.get("readable-review").hidden,true);assert.equal(raw,summary);
  for(const field of['"amount": "2.0"','"networkFee": "1.0"','"maximumFee": "1.2"','"total": "3.2"','"symbol": "YNXT"','"gasLimit": "0x7530"','"fullEVM": false',prepared.review.warning])assert.ok(raw.includes(field),field);
  assert.equal(f.calls.length,1);
});

test("expired delayed GET never enables the redesigned review or sends a decision",async()=>{
  let resolve;const wait=new Promise(r=>{resolve=r}),summary=extensionReviewText((await personal("hello")).review);
  const f=await render({summary,read:()=>wait});f.setNow(2000);resolve();await tick();
  assert.match(f.nodes.get("status").textContent,/SIGNER_REVIEW_EXPIRED/);assert.equal(f.nodes.get("approve").disabled,true);
  f.nodes.get("approve").click();await tick();assert.equal(f.calls.length,1);assert.equal(f.isClosed(),false);
});

test("deadline is checked again before a decision and expiry clears a typed password",async()=>{
  const f=await render({summary:extensionReviewText((await personal("hello")).review)});
  f.nodes.get("password").value="public-synthetic-password";f.setNow(2000);f.nodes.get("approve").click();await tick();
  assert.equal(f.calls.length,1);assert.equal(f.nodes.get("password").value,"");assert.equal(f.nodes.get("approve").disabled,true);
  const timer=await render({summary:"legacy public summary"});timer.nodes.get("password").value="public-synthetic-password";
  for(const{fn}of timer.timers.values())fn();assert.equal(timer.nodes.get("password").value,"");assert.equal(timer.calls.length,1);
});

test("review toggling leaves the exact locator and password decision semantics unchanged; pagehide clears draft",async()=>{
  const f=await render({summary:extensionReviewText((await personal("hello")).review)});
  f.nodes.get("raw-details").open=true;f.nodes.get("password").value="too-short";f.nodes.get("approve").click();await tick();
  assert.equal(f.calls.length,1);assert.match(f.nodes.get("status").textContent,/at least 12/);
  f.nodes.get("password").value="public-synthetic-password";f.nodes.get("approve").click();await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1])),{type:"YNX_SIGNER_DECIDE_V1",requestId:ID,decision:"approve",password:"public-synthetic-password"});
  assert.equal(f.nodes.get("password").value,"");assert.equal(f.isClosed(),true);
  const dismissed=await render({summary:"legacy summary"});dismissed.nodes.get("password").value="public-synthetic-password";
  dismissed.events.pagehide();assert.equal(dismissed.nodes.get("password").value,"");assert.equal(dismissed.calls.length,1);assert.equal(dismissed.timers.size,0);
});
