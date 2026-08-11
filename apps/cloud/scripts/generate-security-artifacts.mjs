import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const sourceCommit=process.argv[2];
if(!/^[0-9a-f]{40}$/.test(sourceCommit||''))throw new Error('usage: node generate-security-artifacts.mjs <exact-source-commit>');
const sha256=body=>createHash('sha256').update(body).digest('hex');
const relative=file=>path.relative(root,file).split(path.sep).join('/');

const modules=[];
const stream=execFileSync('go',['list','-m','-json','all'],{cwd:root,encoding:'utf8'});
let offset=0;
while(offset<stream.length){
  const start=stream.indexOf('{',offset);if(start<0)break;
  let depth=0,end=start;
  for(;end<stream.length;end++){if(stream[end]==='{')depth++;else if(stream[end]==='}'&&--depth===0){end++;break}}
  const value=JSON.parse(stream.slice(start,end));offset=end;
  if(!value.Main)modules.push({type:'library',name:value.Path,version:value.Version,purl:`pkg:golang/${encodeURIComponent(value.Path)}@${encodeURIComponent(value.Version)}`,properties:[{name:'ynx:source',value:'go.mod/go.sum'}]});
}

async function pnpmComponents(file){
  const text=await readFile(file,'utf8'),start=text.indexOf('\npackages:\n'),end=text.indexOf('\nsnapshots:\n');
  if(start<0)throw new Error(`${relative(file)} has no packages section`);
  const section=text.slice(start,end<0?text.length:end),lines=section.split('\n'),components=[];
  for(let i=0;i<lines.length;i++){
    const match=lines[i].match(/^  '([^']+)':$/);if(!match)continue;
    const key=match[1],split=key.lastIndexOf('@');if(split<=0)continue;
    const name=key.slice(0,split),version=key.slice(split+1);if(!name||!version||version.includes('('))continue;
    let integrity='';
    for(let n=i+1;n<Math.min(lines.length,i+8)&&!/^  '[^']+':$/.test(lines[n]);n++){
      const found=lines[n].match(/integrity:\s*(sha(?:256|384|512)-[^}\s]+)/);if(found){integrity=found[1];break}
    }
    components.push({type:'library',name,version,purl:`pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,properties:[{name:'ynx:source',value:relative(file)},...(integrity?[{name:'pnpm:integrity',value:integrity}]:[])]});
  }
  return components;
}

const lockfiles=[path.join(root,'apps/cloud/mobile/pnpm-lock.yaml'),path.join(root,'apps/docs/mobile/pnpm-lock.yaml')];
const npm=(await Promise.all(lockfiles.map(pnpmComponents))).flat();
const unique=new Map();
for(const component of [...modules,...npm]){
  const existing=unique.get(component.purl);
  if(!existing)unique.set(component.purl,component);
  else for(const property of component.properties)if(!existing.properties.some(x=>x.name===property.name&&x.value===property.value))existing.properties.push(property);
}
const components=[...unique.values()].sort((a,b)=>a.purl.localeCompare(b.purl));
const sbom={bomFormat:'CycloneDX',specVersion:'1.5',version:1,metadata:{component:{type:'application',name:'YNX Cloud and Docs Testnet Preview',version:'1.0.0-testnet-preview'},properties:[{name:'ynx:sourceCommit',value:sourceCommit},{name:'ynx:coverage',value:'Go module graph and Cloud/Docs native pnpm package locks; APK file recorded as an artifact subject'}]},components};

const artifactPath=path.join(root,'apps/cloud/release/YNX-Cloud-1.0.0-testnet-preview.apk');
const artifact=await readFile(artifactPath),artifactStat=await stat(artifactPath);
const materials=[];
for(const file of [path.join(root,'go.mod'),path.join(root,'go.sum'),...lockfiles]){const body=await readFile(file);materials.push({uri:relative(file),digest:{sha256:sha256(body)}})}
const provenance={schemaVersion:1,subject:{path:relative(artifactPath),sha256:sha256(artifact),bytes:artifactStat.size,signingClass:'Android debug certificate; Testnet Preview only'},source:{repository:'https://github.com/JiahaoAlbus/YNX-Chain',commit:sourceCommit,branch:'codex/final-cloud'},build:{status:'pre-existing-local-artifact-verified',buildType:'Expo/Gradle Android Testnet Preview',reproducible:false,productionSigned:false,storeReleased:false,claimBoundary:'This record verifies the recovered local artifact and inputs. It is not SLSA provenance, a fresh rebuild, production signing, hosting, or store publication evidence.'},materials};

await writeFile(path.join(root,'apps/cloud/evidence/SBOM.cdx.json'),JSON.stringify(sbom,null,2)+'\n');
await writeFile(path.join(root,'apps/cloud/evidence/ARTIFACT_PROVENANCE.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(`generated ${components.length} locked components and verified ${artifactStat.size} artifact bytes`);
