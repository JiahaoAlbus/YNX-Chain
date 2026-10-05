import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectBinary } from './verify-macos-compatibility.mjs';
const developer=dirname(dirname(fileURLToPath(import.meta.url))),script=await readFile(join(developer,'scripts/package-local-macos.sh'),'utf8');
const root=await mkdtemp('/private/tmp/ynx-packaged-vnode-helper-'),app=join(root,'Fixture.app'),resources=join(app,'Contents/Resources'),floor='27.0';
const exec=(command,args,options={})=>execFileSync(command,args,{cwd:developer,encoding:'utf8',...options});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const blocks=[...script.matchAll(/node --input-type=module - "\$app\/Contents\/Resources" <<'NODE'\n([\s\S]*?)\nNODE/g)].map(match=>match[1]);
test('actual packaged helper compiles at the declared floor, signs and runs the shipped JS contract', async()=>{
  await mkdir(join(resources,'runtime'),{recursive:true});await mkdir(join(resources,'code/apps/developer/desktop'),{recursive:true});await mkdir(join(app,'Contents/MacOS'));
  for(const name of ['local-workbench-lock','workspace-path-identity']){
    const command=script.split('\n').find(line=>line.includes('/usr/bin/clang')&&line.includes('desktop/macos/'+name+'.c'));
    assert.ok(command);exec('/bin/bash',['-c',command],{env:{...process.env,app,macos_min_version:floor}});
  }
  const copy=script.split('\n').find(line=>line.trim().startsWith('cp desktop/workspace-path-identity.mjs '));assert.ok(copy);
  exec('/bin/bash',['-c',copy],{env:{...process.env,app}});
  for(const name of ['ynx-local-workbench-lock','workspace-path-identity']){
    const binary=join(resources,'runtime',name);assert.equal(inspectBinary(binary).find(slice=>slice.architecture===process.arch).minimumOS,floor);
    exec('/usr/bin/codesign',['--force','--sign','-',binary]);exec('/usr/bin/codesign',['--verify','--strict',binary]);
  }
  const shipped=await import(pathToFileURL(join(resources,'code/apps/developer/desktop/workspace-path-identity.mjs')));
  const project=join(root,'selected');await mkdir(project);
  const proof=await shipped.inspectWorkspacePathIdentity({helper:join(resources,'runtime/workspace-path-identity'),path:project});
  assert.equal(proof.canonical,project);await shipped.assertWorkspacePathIdentity(proof);
});
test('source-extracted final ledger binds both signed native helpers and JS, rejects corruption after outer seal',async()=>{
  const ledger=blocks.find(block=>block.includes('provenance.localWorkspaceHelpers='));assert.ok(ledger);
  const code=ledger.slice(ledger.indexOf('provenance.localWorkspaceHelpers='),ledger.indexOf('await writeFile(provenancePath'));
  const provenancePath=join(resources,'build-provenance.json');await writeFile(provenancePath,JSON.stringify({minimumOS:floor}));
  const header=`import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';const resources=${JSON.stringify(resources)},provenancePath=join(resources,'build-provenance.json'),provenance=JSON.parse(await readFile(provenancePath));const sha=bytes=>createHash('sha256').update(bytes).digest('hex');\n`;
  exec(process.execPath,['--input-type=module','-e',header+code+"await writeFile(provenancePath,JSON.stringify(provenance));"]);
  await copyFile(join(resources,'runtime/workspace-path-identity'),join(app,'Contents/MacOS/Fixture'));
  await writeFile(join(app,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.ynx.helper-test</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  exec('/usr/bin/codesign',['--force','--deep','--sign','-',app]);exec('/usr/bin/codesign',['--verify','--deep','--strict',app]);
  const final=blocks.find(block=>block.includes("const expected=['Contents/Resources/runtime/ynx-local-workbench-lock'"));assert.ok(final);
  const checks=final.slice(final.indexOf('const expected='),final.indexOf("console.log('Final signed Node"));
  exec(process.execPath,['--input-type=module','-e',header+checks]);
  const record=JSON.parse(await readFile(provenancePath));assert.equal(record.localWorkspaceHelpers.minimumOS,floor);assert.equal(record.localWorkspaceHelpers.files.length,3);
  for(const entry of record.localWorkspaceHelpers.files)assert.equal(entry.sourceSha256,sha(await readFile(join(developer,entry.source))));
  const js=join(resources,'code/apps/developer/desktop/workspace-path-identity.mjs');const original=await readFile(js);await writeFile(js,Buffer.concat([original,Buffer.from('\n// altered fixture\n')]));
  assert.throws(()=>exec(process.execPath,['--input-type=module','-e',header+checks]),/Outer signing changed recorded workspace helper bytes/);await writeFile(js,original);
  console.log('Retained packaged helper fixture:',root);
});
