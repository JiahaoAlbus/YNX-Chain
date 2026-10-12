import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, chmod, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { preparePtyDistribution, sealPtyDistribution, verifyPtyDistribution, reviewedPtyFiles } from './package-node-pty-distribution.mjs';
const developer=dirname(dirname(fileURLToPath(import.meta.url))),base=await mkdtemp('/Volumes/Data/Users/huangjiahao/.ynx-ide-build-artifacts-v2-20261005/pty-signed-fixture-');
const app=join(base,'Fixture.app'),resources=join(app,'Contents/Resources'),root=join(resources,'code/apps/developer/node_modules/node-pty');
const exec=(command,args,options={})=>execFileSync(command,args,{encoding:'utf8',stdio:'pipe',...options});
test('exact original package, license, JS/native closure prepared without installation',async()=>{
 assert.equal(process.version,'v26.7.0');
 for(const file of reviewedPtyFiles()){
  await mkdir(dirname(join(root,file.path)),{recursive:true});await copyFile(join(developer,'node_modules/node-pty',file.path),join(root,file.path));
  await chmod(join(root,file.path),(await lstat(join(developer,'node_modules/node-pty',file.path))).mode & 0o777);
 }
 await writeFile(join(resources,'build-provenance.json'),JSON.stringify({fixture:true}));
 await preparePtyDistribution(resources);await assert.rejects(preparePtyDistribution(resources),/EEXIST/);
});
test('real ad-hoc transform and outer App seal preserve ledger; actual Node26 PTY spawn/exits',async()=>{
 for(const file of reviewedPtyFiles().filter(file=>file.kind==='macho'))exec('/usr/bin/codesign',['--force','--sign','-',join(root,file.path)]);
 await sealPtyDistribution(resources);
 await mkdir(join(app,'Contents/MacOS'));
 await copyFile(join(root,`prebuilds/darwin-${process.arch}/spawn-helper`),join(app,'Contents/MacOS/Fixture'));
 await writeFile(join(app,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.ynx.pty-fixture</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
 exec('/usr/bin/codesign',['--force','--deep','--sign','-',app]);exec('/usr/bin/codesign',['--verify','--deep','--strict',app]);
 const ledger=await verifyPtyDistribution(resources);assert.equal(ledger.files.length,9);
 const result=exec(process.execPath,['-e',`const pty=require(${JSON.stringify(root)});const terminal=pty.spawn('/bin/sh',['-c','stty -echo; printf READY; read input; stty size; printf "YNX_PTY_%s" "$input"; exit 17'],{name:'xterm',cols:80,rows:24,cwd:${JSON.stringify(base)},env:{PATH:'/usr/bin:/bin'}});let text='',sent=false;const timer=setTimeout(()=>{terminal.kill();process.exit(90)},5000);terminal.onData(data=>{text+=data;if(!sent&&text.includes('READY')){sent=true;terminal.resize(101,37);terminal.write('ACTUAL\\n');}});terminal.onExit(event=>{clearTimeout(timer);console.log(JSON.stringify({text,exitCode:event.exitCode,node:process.version}));if(!text.includes('YNX_PTY_ACTUAL')||!text.includes('37 101')||event.exitCode!==17)process.exit(91);});`],{env:{...process.env,OPENSSL_CONF:'/dev/null'}});
 const observed=JSON.parse(result.trim());assert.equal(observed.node,'v26.7.0');assert.equal(observed.exitCode,17);assert.match(observed.text,/37 101/);assert.match(observed.text,/YNX_PTY_ACTUAL/);
 console.log('Retained signed PTY fixture:',base);
});
test('source/license/native tampering and provenance rebinding refuse without bypass',async()=>{
 for(const file of ['LICENSE',`prebuilds/darwin-${process.arch}/pty.node`]){
  const path=join(root,file),bytes=await readFile(path);await writeFile(path,Buffer.concat([bytes,Buffer.from('changed')]));
  await assert.rejects(verifyPtyDistribution(resources),/bytes differ/);await writeFile(path,bytes);
 }
 const helper=join(root,`prebuilds/darwin-${process.arch}/spawn-helper`);await chmod(helper,0o644);await assert.rejects(verifyPtyDistribution(resources),/mode changed/);await chmod(helper,0o755);
 const path=join(resources,'build-provenance.json'),bytes=await readFile(path),record=JSON.parse(bytes);record.debugPtyDistribution.sha256='0'.repeat(64);await writeFile(path,JSON.stringify(record));
 await assert.rejects(verifyPtyDistribution(resources),/provenance differs/);await writeFile(path,bytes);
 await verifyPtyDistribution(resources);
});
test('changed native machine-code payload with a valid ad-hoc signature refuses before seal and cannot rebaseline',async()=>{
 for(const victim of reviewedPtyFiles().filter(file=>file.kind==='macho')){
  const attack=await mkdtemp(join(base,'preseal-attack-')),targetResources=join(attack,'Fixture.app/Contents/Resources'),targetRoot=join(targetResources,'code/apps/developer/node_modules/node-pty');
  for(const file of reviewedPtyFiles()){
   const source=join(developer,'node_modules/node-pty',file.path),target=join(targetRoot,file.path);await mkdir(dirname(target),{recursive:true});await copyFile(source,target);await chmod(target,(await lstat(source)).mode&0o777);
  }
  await writeFile(join(targetResources,'build-provenance.json'),JSON.stringify({fixture:true}));await preparePtyDistribution(targetResources);
  const ledgerPath=join(targetRoot,'YNX-SIGNED-DISTRIBUTION.json'),before=await readFile(ledgerPath),path=join(targetRoot,victim.path),bytes=await readFile(path);
  assert.equal(bytes.readUInt32LE(0),0xfeedfacf);
  let command=32,textOffset;
  for(let index=0;index<bytes.readUInt32LE(16);index++){
   if(bytes.readUInt32LE(command)===0x19){
    for(let section=0;section<bytes.readUInt32LE(command+64);section++){
     const at=command+72+section*80;
     if(bytes.toString('ascii',at,at+16).replace(/\0.*$/,'')==='__text')textOffset=bytes.readUInt32LE(at+48);
    }
   }
   command+=bytes.readUInt32LE(command+4);
  }
  assert.ok(Number.isInteger(textOffset)&&textOffset>0&&textOffset<bytes.length);
  bytes[textOffset]^=1;await writeFile(path,bytes);
  for(const file of reviewedPtyFiles().filter(file=>file.kind==='macho'))exec('/usr/bin/codesign',['--force','--sign','-',join(targetRoot,file.path)]);
  exec('/usr/bin/codesign',['--verify','--strict',path]);
  const signature=await import('node:child_process').then(({spawnSync})=>spawnSync('/usr/bin/codesign',['-dv','--verbose=4',path],{encoding:'utf8'}));
  assert.match(signature.stderr,/Signature=adhoc/);assert.match(signature.stderr,/TeamIdentifier=not set/);
  await assert.rejects(sealPtyDistribution(targetResources),/payload differs from the reviewed original signing transformation/);
  assert.deepEqual(await readFile(ledgerPath),before);
 }
});
