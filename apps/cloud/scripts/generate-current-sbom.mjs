import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const sourceCommit=process.argv[2];
if(!/^[0-9a-f]{40}$/.test(sourceCommit||''))throw new Error('usage: node generate-current-sbom.mjs <exact-source-commit>');
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==sourceCommit)throw new Error('source commit must equal HEAD');
const components=[];
const add=(name,version,purl,source)=>{if(name&&version)components.push({type:'library',name,version,purl,properties:[{name:'ynx:source',value:source}]})};
const stream=execFileSync('go',['list','-m','-json','all'],{cwd:root,encoding:'utf8'});
let offset=0;
while(offset<stream.length){const start=stream.indexOf('{',offset);if(start<0)break;let depth=0,end=start;for(;end<stream.length;end++){if(stream[end]==='{')depth++;else if(stream[end]==='}'&&--depth===0){end++;break}}const value=JSON.parse(stream.slice(start,end));offset=end;if(!value.Main)add(value.Path,value.Version,`pkg:golang/${encodeURIComponent(value.Path)}@${encodeURIComponent(value.Version)}`,'go.mod/go.sum')}
const pnpm=await readFile(path.join(root,'apps/cloud/mobile/pnpm-lock.yaml'),'utf8');
const packages=pnpm.slice(pnpm.indexOf('\npackages:\n'),pnpm.indexOf('\nsnapshots:\n'));
for(const match of packages.matchAll(/^  '([^']+)':$/gm)){const key=match[1],at=key.lastIndexOf('@');if(at>0&&!key.slice(at+1).includes('('))add(key.slice(0,at),key.slice(at+1),`pkg:npm/${encodeURIComponent(key.slice(0,at))}@${encodeURIComponent(key.slice(at+1))}`,'apps/cloud/mobile/pnpm-lock.yaml')}
const npmLock=JSON.parse(await readFile(path.join(root,'apps/cloud/package-lock.json'),'utf8'));
for(const [entry,value] of Object.entries(npmLock.packages||{})){if(!entry.startsWith('node_modules/')||!value.version)continue;const name=entry.slice('node_modules/'.length);add(name,value.version,`pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(value.version)}`,'apps/cloud/package-lock.json')}
const unique=new Map();for(const component of components)if(!unique.has(component.purl))unique.set(component.purl,component);
const sbom={bomFormat:'CycloneDX',specVersion:'1.5',version:1,metadata:{component:{type:'application',name:'YNX Cloud source candidate',version:'P0-071'},properties:[{name:'ynx:sourceCommit',value:sourceCommit},{name:'ynx:coverage',value:'Current repository Go module graph plus YNX Cloud Web build and native package locks; no historical APK or deployment claim.'}]},components:[...unique.values()].sort((a,b)=>a.purl.localeCompare(b.purl))};
await writeFile(path.join(root,'apps/cloud/evidence/p0-071/SBOM.cdx.json'),JSON.stringify(sbom,null,2)+'\n');
console.log(`generated current-source SBOM with ${sbom.components.length} components`);
