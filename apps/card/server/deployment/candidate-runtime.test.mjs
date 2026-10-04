import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./candidate-runtime.mjs',import.meta.url));
test('actual isolated main serves public metadata but refuses protected startup before state',()=>{
  const parent=mkdtempSync(join(tmpdir(),'ynx-card-candidate-test-')),output=join(parent,'evidence');
  const source='a'.repeat(40);
  const result=spawnSync(process.execPath,[script,source,output],{encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH,YNX_CARD_AUTH_ADAPTER_MODULE:'/must-not-inherit',YNX_CARD_TEST_PROGRAMS_JSON:'invalid-inherited-setting'}});
  assert.equal(result.status,0,result.stderr+result.stdout);
  const receipt=JSON.parse(readFileSync(join(output,'results.json'),'utf8'));
  assert.equal(receipt.passed,true);assert.equal(receipt.protectedRuntimeReady,false);assert.equal(receipt.realFunding,false);
  const [publicResult,protectedResult]=receipt.scenarios;
  assert.equal(publicResult.exit.code,0);assert.equal(publicResult.resources[0].status,200);
  assert.ok(publicResult.resources[1].status>=400);
  assert.equal(protectedResult.exit.code,1);assert.deepEqual(protectedResult.stateFiles,[]);
  assert.equal(readFileSync(join(output,'protected-missing-authority','stderr.log'),'utf8').trim(),'CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE');
  const repeat=spawnSync(process.execPath,[script,source,output],{encoding:'utf8',timeout:5000});
  assert.notEqual(repeat.status,0);assert.ok(existsSync(join(output,'results.json')));
});
test('candidate refuses non-exact source before creating evidence',()=>{
  const parent=mkdtempSync(join(tmpdir(),'ynx-card-candidate-invalid-')),output=join(parent,'evidence');
  const result=spawnSync(process.execPath,[script,'HEAD',output],{encoding:'utf8',timeout:5000});
  assert.notEqual(result.status,0);assert.equal(existsSync(output),false);
});
