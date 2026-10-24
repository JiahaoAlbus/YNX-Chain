import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {prepareR237PrincipalCI} from '../../../scripts/ci/auth-r237-principal-supply.mjs';

test('original R237 principal completion rejects late invalidation at physical HTTP delivery', t => {
  const scratch=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'ynx-r237-principal-test-')));
  const prepared=prepareR237PrincipalCI({outputRoot:path.join(scratch,'closed-sdk')});
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap',prepared.test],{
    cwd:prepared.outputRoot,env:{...process.env,TMPDIR:scratch},encoding:'utf8',timeout:30000,maxBuffer:10485760
  });
  fs.writeFileSync(path.join(scratch,'stdout.log'),result.stdout??'',{flag:'wx'});
  fs.writeFileSync(path.join(scratch,'stderr.log'),result.stderr??'',{flag:'wx'});
  t.diagnostic(`Original new-nine evidence preserved at ${scratch}`);
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.signal,null);
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const output=result.stdout,names=[...output.matchAll(/^ok \d+ - (.+)$/gm)].map(x=>x[1]);
  assert.equal(names.length,9);
  assert.equal(new Set(names).size,9);
  assert(names.every(name=>prepared.testNames.includes(name)));
  for(const marker of ['tests 9','pass 9','fail 0','skipped 0','cancelled 0'])assert(output.split(/\r?\n/).includes('# '+marker),marker);
  assert(!/^not ok/m.test(output));
  assert(!/# SKIP|# TODO/.test(output));
});
