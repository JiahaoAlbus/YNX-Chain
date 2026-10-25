import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {copyCanonicalIdentityHelper} from './package-identity-admission-source.mjs';
const inputs=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
test('actual SDK39 helper copied to original bundle paths without installation or execution',async()=>{const temp=await mkdtemp(join(tmpdir(),'ynx-ide39-helper-'));try{const code=join(temp,'Fixture.app/Contents/Resources/code');await mkdir(code,{recursive:true});await copyCanonicalIdentityHelper(code);for(const key of ['helper','helperPlist']){const raw=await readFile(join(temp,'Fixture.app',inputs.helperComponent.destinations[key]));assert.equal(raw.length,inputs.helperComponent[key].bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),inputs.helperComponent[key].sha256);}await assert.rejects(copyCanonicalIdentityHelper(code),/EEXIST/);}finally{await rm(temp,{recursive:true,force:true});}});
