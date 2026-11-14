import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('normal Cross entry opens history, and close or cancel invalidates pending work',()=>{
  const source=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');
  const start=source.indexOf("cctpOpen.addEventListener('click',");
  const end=source.indexOf("\n",start);
  assert.ok(start>=0&&end>start,'normal Cross entry must exist');
  const events=[];
  const target=()=>({handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}});
  const cctpOpen=target(),cctpClose=target(),cctpDialog=Object.assign(target(),{showModal(){events.push('show')},close(){events.push('close')}});
  const cctpUI={open(){events.push('open-history');return Promise.resolve()},invalidate(){events.push('invalidate')}};
  new Function('cctpOpen','cctpClose','cctpDialog','cctpUI',source.slice(start,end))(cctpOpen,cctpClose,cctpDialog,cctpUI);
  cctpOpen.handlers.click();assert.deepEqual(events,['show','open-history']);
  events.length=0;cctpClose.handlers.click();assert.deepEqual(events,['invalidate','close']);
  events.length=0;cctpDialog.handlers.cancel();assert.deepEqual(events,['invalidate']);
});
