import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {patchSecureStoreSource} from './secure-store-native-patch.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const dependencies=[
 ['org.jetbrains.kotlin','kotlin-compiler-embeddable','2.1.20','c54a00718c8c0e3ee858bf42771c7f401c5e3c1738861e18e9536371042fa1b3'],
 ['org.jetbrains.kotlin','kotlin-stdlib','2.1.20','1bcc74e8ce84e2c25eaafde10f1248349cce3062b6e36978cbeec610db1e930a'],
 ['org.jetbrains','annotations','13.0','ace2a10dc8e2d5fd34925ecac03e4988b2c0f851650c94b8cef49ba1bd111478'],
 ['org.jetbrains.kotlin','kotlin-script-runtime','2.1.20','ae4397fbb3aa2a1ada09290e753bba99a4114548977c3115526b9958f4cb1a04'],
 ['org.jetbrains.intellij.deps','trove4j','1.0.20200330','c5fd725bffab51846bf3c77db1383c60aaaebfe1b7fe2f00d23fe1b7df0a439d'],
 ['org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.8.1','f3d4f5de1c391bbcc20f3b3435ccbac013521e76b6902d7d59635ec15c1f797e'],
];
test('actual patched Kotlin read methods preserve existing public ciphertext on missing/invalid keys and decrypt failures',async t=>{
 const spec=JSON.parse(fs.readFileSync(path.join(root,'native-patches/expo-secure-store-57.0.3.json')));
 const source=process.env.WALLET_SECURESTORE_SOURCE??path.join(root,'node_modules/expo-secure-store',spec.file);
 const text=patchSecureStoreSource(fs.readFileSync(source),spec);const hash=s=>createHash('sha256').update(s).digest('hex');
 assert.equal(hash(text),spec.patchedSha256,'Native fixture must execute exact reviewed patched source, not a model');
 const start=text.indexOf('  private suspend fun getItemImpl('),end=text.indexOf('  private suspend fun setItemImpl(');
 assert(start>0&&end>start);const methods=text.slice(start,end);
 const helper=fs.readFileSync(path.join(root,'native-patches/YNXSecureStoreWriteBarrier.kt'),'utf8');assert.equal(hash(helper),spec.helper.sha256);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-secure-read-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const cache=process.env.WALLET_KOTLIN_CACHE??path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1');
 // Reviewed compiler/runtime bytes, from the existing Gradle cache or exact
 // Maven Central URLs. CI needs no developer-specific cache or Android device.
 const jars=await Promise.all(dependencies.map(async([group,name,version,pin])=>{
  const directory=path.join(cache,group,name,version),filename=`${name}-${version}.jar`;
  const cached=fs.existsSync(directory)?fs.readdirSync(directory,{recursive:true}).filter(n=>n.endsWith('/'+filename)||n===filename).map(n=>path.join(directory,n)):[];
  for(const file of cached)if(hash(fs.readFileSync(file))===pin)return file;
  const response=await fetch(`https://repo.maven.apache.org/maven2/${group.replaceAll('.','/')}/${name}/${version}/${filename}`,{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,'Pinned PUBLIC Kotlin tool download failed');
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),pin,'Kotlin dependency bytes differ from reviewed compiler');
  const file=path.join(temp,filename);fs.writeFileSync(file,bytes,{flag:'wx'});return file;
 }));
 const stdlib=[jars[1]],annotations=[jars[2]],cp=jars.join(path.delimiter);
 const fixture=fs.readFileSync(path.join(root,'native-patches/test/ReadPreservationPUBLIC.kt'),'utf8').replace('// EXACT_REVIEWED_READ_METHODS',methods);
 const kotlin=path.join(temp,'ReadPreservationPUBLIC.kt'),barrier=path.join(temp,'YNXSecureStoreWriteBarrier.kt'),stub=path.join(temp,'CodedExceptionPUBLIC.kt');
 fs.writeFileSync(kotlin,fixture);fs.writeFileSync(barrier,helper);fs.writeFileSync(stub,'package expo.modules.kotlin.exception\nopen class CodedException(message: String?, cause: Throwable? = null): RuntimeException(message, cause)\n');
 const output=path.join(temp,'classes');
 const localJava='/opt/homebrew/Cellar/openjdk@17/17.0.17/libexec/openjdk.jdk/Contents/Home/bin/java';
 const java=process.env.WALLET_JAVA??(process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin/java'):fs.existsSync(localJava)?localJava:'java');
 const compile=spawnSync(java,['-cp',cp,'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-classpath',[...stdlib,...annotations].join(path.delimiter),'-d',output,kotlin,barrier,stub],{encoding:'utf8',timeout:60000});
 assert.equal(compile.status,0,compile.stderr);
 const run=spawnSync(java,['-cp',[output,...stdlib].join(path.delimiter),'expo.modules.securestore.ReadPreservationPUBLICKt'],{encoding:'utf8',timeout:10000});
 assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.equal(run.stdout.match(/^PASS /gm)?.length,9,run.stdout);
 assert.match(run.stdout,/PUBLIC_ONLY noDevice=1 actualKeyStore=0 writes=0/);
});
