import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const read=async file=>readFile(path.join(root,file),'utf8');
const sha256=body=>createHash('sha256').update(body).digest('hex');
const failures=[];
const fail=message=>failures.push(message);

async function walk(relative){
  const absolute=path.join(root,relative),out=[];
  for(const entry of await readdir(absolute,{withFileTypes:true})){
    if(['node_modules','dist','build','.gradle'].includes(entry.name))continue;
    const child=path.join(relative,entry.name);
    if(entry.isDirectory())out.push(...await walk(child));
    else out.push(child.split(path.sep).join('/'));
  }
  return out;
}

const runtimeFiles=[...(await walk('internal/cloud')).filter(x=>x.endsWith('.go')&&!x.endsWith('_test.go')),...(await walk('apps/cloud/web')),...(await walk('apps/cloud/mobile/src')),'apps/cloud/mobile/App.tsx',...(await walk('apps/cloud/sdk')).filter(x=>!x.endsWith('package.json'))];
const forbidden=[[/\b(?:TODO|FIXME)\b/i,'unfinished marker'],[/\bcoming soon\b/i,'coming-soon claim'],[/example\.com/i,'example.com endpoint'],[/\bfake (?:balance|user|transaction|price|revenue|apy|liquidity|provider|health)\b/i,'fake runtime claim'],[/\bhard[- ]coded success\b/i,'hard-coded success'],[/\bmock provider\b/i,'mock provider'],[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,'private key'],[/\bAKIA[0-9A-Z]{16}\b/,'AWS access key'],[/\bgh[opusr]_[A-Za-z0-9]{30,}\b/,'GitHub token'],[/localStorage[^\n]{0,80}(?:token|session)/i,'browser-persisted session']];
for(const file of runtimeFiles){
  const body=await read(file);
  for(const [pattern,label] of forbidden)if(pattern.test(body))fail(`${file}: ${label}`);
}

const allowlist=JSON.parse(await read('apps/cloud/security/build-script-allowlist.json'));
for(const [file,allowed] of Object.entries(allowlist.packages)){
  const pkg=JSON.parse(await read(file)),actual=Object.keys(pkg.scripts||{}).sort(),expected=[...allowed].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))fail(`${file}: scripts differ from reviewed allowlist`);
  for(const lifecycle of allowlist.forbiddenLifecycleScripts)if(pkg.scripts?.[lifecycle])fail(`${file}: forbidden lifecycle script ${lifecycle}`);
}

for(const file of ['apps/cloud/mobile/pnpm-lock.yaml','apps/docs/mobile/pnpm-lock.yaml']){
  const body=await read(file);if(!body.startsWith("lockfileVersion: '9.0'"))fail(`${file}: unexpected lock schema`);if(!/integrity: sha512-/.test(body))fail(`${file}: package integrity records absent`);
}
for(const file of ['apps/cloud/evidence/SBOM.cdx.json','apps/cloud/evidence/ARTIFACT_PROVENANCE.json','apps/cloud/evidence/ARTIFACT_MANIFEST.json','apps/cloud/security/build-script-allowlist.json']){
  try{JSON.parse(await read(file))}catch{fail(`${file}: invalid JSON`)}
}
const manifest=JSON.parse(await read('apps/cloud/evidence/ARTIFACT_MANIFEST.json'));
for(const item of manifest.artifacts){
  const body=await readFile(path.join(root,item.path)),info=await stat(path.join(root,item.path));
  if(sha256(body)!==item.sha256||info.size!==item.bytes)fail(`${item.path}: artifact hash/size mismatch`);
  if(item.productionSigned===true||item.downloadHosted===true)fail(`${item.path}: unsupported release claim`);
}
const provenance=JSON.parse(await read('apps/cloud/evidence/ARTIFACT_PROVENANCE.json'));
if(provenance.subject.sha256!==manifest.artifacts[0].sha256||provenance.subject.bytes!==manifest.artifacts[0].bytes||provenance.source.commit!==manifest.artifacts[0].verifiedAtSourceCommit)fail('provenance subject/source differs from artifact manifest');
for(const material of provenance.materials){const body=await readFile(path.join(root,material.uri));if(sha256(body)!==material.digest.sha256)fail(`${material.uri}: provenance material digest is stale`)}
try{execFileSync('git',['merge-base','--is-ancestor',provenance.source.commit,'HEAD'],{cwd:root,stdio:'pipe'})}catch{fail('provenance source commit is not an ancestor of HEAD')}
const sbom=JSON.parse(await read('apps/cloud/evidence/SBOM.cdx.json'));
if(sbom.bomFormat!=='CycloneDX'||sbom.components.length<100)fail('SBOM coverage is unexpectedly small');
const purls=new Set(sbom.components.map(x=>x.purl));
for(const line of execFileSync('go',['list','-m','all'],{cwd:root,encoding:'utf8'}).trim().split('\n').slice(1)){
  const [name,version]=line.split(/\s+/);if(name&&version&&!purls.has(`pkg:golang/${encodeURIComponent(name)}@${encodeURIComponent(version)}`))fail(`SBOM missing Go module ${name}@${version}`);
}
for(const file of ['apps/cloud/mobile/pnpm-lock.yaml','apps/docs/mobile/pnpm-lock.yaml']){
  const body=await read(file),section=body.slice(body.indexOf('\npackages:\n'),body.indexOf('\nsnapshots:\n'));
  for(const match of section.matchAll(/^  '([^']+)':$/gm)){
    const key=match[1],at=key.lastIndexOf('@');if(at<=0)continue;const name=key.slice(0,at),version=key.slice(at+1);if(version.includes('('))continue;
    if(!purls.has(`pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`))fail(`SBOM missing locked package ${name}@${version}`);
  }
}

const publicFiles=['apps/cloud/public-product-metadata.json','apps/cloud/product-release.json','apps/cloud/RELEASE_NOTES.md'];
for(const file of publicFiles){const body=await read(file);for(const pattern of [/Codex/i,/Worktree/i,/\/Users\//,/localhost/i,/127\.0\.0\.1/])if(pattern.test(body))fail(`${file}: internal release text`)}

try{execFileSync('go',['vet','./internal/cloud','./apps/cloud/cmd/ynx-cloudd'],{cwd:root,stdio:'pipe'})}catch(error){fail(`go vet failed: ${String(error.stderr||error.message).trim()}`)}
try{
  const listing=execFileSync('unzip',['-Z1','apps/cloud/release/YNX-Cloud-1.0.0-testnet-preview.apk'],{cwd:root,encoding:'utf8'});
  if(/\.(?:pem|key|p12|pfx|jks|keystore)$/im.test(listing))fail('APK contains a private-key or keystore filename');
}catch(error){fail(`APK archive inspection failed: ${error.message}`)}

if(failures.length){for(const failure of failures)console.error(`SECURITY_GATE: ${failure}`);process.exit(1)}
console.log(`YNX Cloud security gate passed: ${runtimeFiles.length} runtime files, ${sbom.components.length} locked components, exact artifact evidence`);
