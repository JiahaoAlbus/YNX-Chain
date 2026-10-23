import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';

// Execute the actual injected production strings. No Native receiver, file
// panel, signer, user approval or system installation is represented here.
const source=await readFile(new URL('./macos/main.m',import.meta.url),'utf8');
const cases=[
  ['file open','file',w=>w.ynxDesktopFiles.open({kind:'file'})],
  ['file save','file',w=>w.ynxDesktopFiles.save({name:'hello.go'})],
  ['Go selection','go',w=>w.ynxDesktopGo.selectToolchain()],
  ['Trash','trash',w=>w.ynxDesktopTrash.trash('hello.go')],
  ['Wallet','wallet',w=>w.ynxDesktopWallet.walletAvailability()],
  ['original service','wallet',w=>w.ynxDesktopWallet.originalServiceDispatch('{}')],
];
function fixture(t,kind){
  const line=source.split('\n').find(line=>line.includes('NSString *'+kind+'Script='));
  assert.ok(line,'actual injected script must exist');
  const script=line.match(/(?:stringWithFormat:)?@"(.*)"(?:,YNXJSON|;)/)[1].replace('%@','null');
  const frames=[],events=[],timers=new Map();let clock=0,transportError;
  const postMessage=body=>{if(transportError)throw transportError;frames.push(body);};
  const window={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage},ynxLocalWallet:{postMessage}}}};
  vm.runInNewContext(script,{window,location:{pathname:'/'},crypto:{randomUUID},DOMException,TextEncoder,
    addEventListener:(name,listener)=>{if(name==='pagehide')events.push(listener);},
    setTimeout:fn=>{timers.set(++clock,fn);return clock;},clearTimeout:id=>timers.delete(id)});
  const retire=()=>{for(const listener of events)listener();};t.after(retire);
  return {window,frames,timers,retire,fail:error=>{transportError=error;}};
}
for(const [label,kind,start]of cases){
  test('retired '+label+' bridge rejects a late request without IPC or timer',async t=>{
    const f=fixture(t,kind);f.retire();
    const outcome=start(f.window).then(()=>undefined,error=>error);
    const dispatched=f.frames.length;f.retire();const error=await outcome;
    assert.equal(dispatched,0,'retired document dispatched a new request');
    assert.ok(error instanceof Error||typeof error?.message==='string');
    assert.match(error.message,/closed|retired/i);assert.equal(f.timers.size,0);
  });
  test(label+' synchronous transport failure releases UI bookkeeping without asserting Native cleanup',async t=>{
    const f=fixture(t,kind),first=Error('PUBLIC_TRANSPORT_FAILURE');f.fail(first);
    // Trash/Wallet retain a bounded Map, so exercise its actual capacity too.
    const attempts=['trash','wallet'].includes(kind)?32:1;
    for(let i=0;i<attempts;i++)await assert.rejects(start(f.window),error=>error===first);
    assert.equal(f.timers.size,0,'failed dispatch retained a UI timer');
    f.fail(undefined);
    const retry=start(f.window).then(()=>undefined,error=>error),sent=f.frames.length;
    f.retire();await retry;
    assert.equal(sent,1,'explicit retry was blocked by leaked UI jobs');
    assert.equal(f.timers.size,0);
  });
}
