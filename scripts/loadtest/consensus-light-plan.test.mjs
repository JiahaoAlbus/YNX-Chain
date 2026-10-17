import test from 'node:test';
import assert from 'node:assert/strict';
import {lightCommand} from './consensus-light-plan.mjs';

test('default focused compile command and caps environment are retained',()=>{
  const p=lightCommand('/work');assert.equal(p.mode,'focused_go');assert.equal(p.args[2],'/opt/homebrew/bin/go');assert.equal(p.env.GOMEMLIMIT,'160MiB');assert.equal(p.env.GOGC,'50');assert.equal(p.env.GOMAXPROCS,'1');assert.equal(p.env.YNX_CHAIN_STOPPED_WINDOW,undefined);
});
test('stopped replay uses only the retained binary and exact two tests',()=>{
  const p=lightCommand('/work','/work/artifacts/chain-network-performance/window-eEfGE7');assert.equal(p.mode,'stopped_replay');assert.equal(p.args[2],p.binary);assert.equal(p.args[4],'^(TestStoppedNetworkReplay|TestStoppedReadySenderAccountReadback)$');assert.equal(p.env.YNX_CHAIN_STOPPED_WINDOW,p.window);assert.match(p.binarySHA256,/^[a-f0-9]{64}$/);assert.ok(!p.args.includes('go'));
});
test('stopped window rejects external paths, nested paths and empty mode',()=>{
  for(const w of ['/tmp/window-eEfGE7','/work/artifacts/chain-network-performance/window-eEfGE7/network',''])assert.throws(()=>lightCommand('/work',w));
});
