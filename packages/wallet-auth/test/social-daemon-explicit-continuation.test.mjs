import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const text=fs.readFileSync(new URL('../scripts/ynx-wallet-gatewayd.mjs',import.meta.url),'utf8'),start=text.indexOf('function stopOriginalDaemon(reason){'),end=text.indexOf('\n// Select only the real original v2 instance',start);assert.ok(start>=0&&end>start);
test('only a later OS shutdown signal continues the same Social debt, not listener callbacks',async()=>{
 let n=0;const first=Promise.resolve('original'),events=[];const context=vm.createContext({Promise,originalShutdown:first,originalSocialSourceStartup:{},continueOriginalSocialParentDrain:async()=>{n++},emitEvent:e=>events.push(e)});vm.runInContext(text.slice(start,end)+';this.stop=stopOriginalDaemon;',context);
 for(const reason of ['listener_closed','listener_error','original_private_runtime_failed'])assert.equal(context.stop(reason),first);
 await Promise.resolve();assert.equal(n,0);assert.equal(events.length,0);
 assert.equal(context.stop('SIGTERM'),first);await new Promise(r=>setImmediate(r));assert.equal(n,1);assert.equal(events[0].event,'social_source_parent_drain_completed');assert.equal(context.stop('SIGINT'),first);await new Promise(r=>setImmediate(r));assert.equal(n,2);
});
