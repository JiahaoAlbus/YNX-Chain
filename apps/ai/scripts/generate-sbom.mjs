import {execFileSync} from "node:child_process";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const aiRoot=resolve(fileURLToPath(new URL("../",import.meta.url)));
const repoRoot=resolve(aiRoot,"../..");
const mobileRoot=resolve(aiRoot,"mobile");
const output=resolve(aiRoot,"sbom.cdx.json");
const components=new Map();
const add=(type,name,version,purl)=>{
  if(!name||!version)return;
  const key=`${type}:${name}@${version}`;
  components.set(key,{type,name,version,purl,properties:[{name:"ynx:scope",value:"YNX AI source dependency"}]});
};

const goRaw=execFileSync("go",["list","-m","-json","all"],{cwd:repoRoot,encoding:"utf8",maxBuffer:32<<20});
for(const block of goRaw.trim().split(/\n}\n(?={)/).map((value,index,array)=>value+(index<array.length-1?"}":""))){
  const module=JSON.parse(block);
  if(module.Main)continue;
  add("library",module.Path,module.Version,`pkg:golang/${encodeURIComponent(module.Path)}@${encodeURIComponent(module.Version)}`);
}
const lock=await readFile(resolve(mobileRoot,"pnpm-lock.yaml"),"utf8");
const packageSection=lock.slice(lock.indexOf("\npackages:\n"),lock.indexOf("\nsnapshots:\n"));
for(const line of packageSection.split("\n")){
  const match=line.match(/^  ['"]?(.+?)['"]?:$/);
  if(!match)continue;
  const key=match[1],separator=key.lastIndexOf("@");
  if(separator<=0)continue;
  const name=key.slice(0,separator),version=key.slice(separator+1);
  add("library",name,version,`pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`);
}

const timestamp=process.env.SOURCE_DATE_EPOCH?new Date(Number(process.env.SOURCE_DATE_EPOCH)*1000).toISOString():new Date().toISOString();
const bom={bomFormat:"CycloneDX",specVersion:"1.5",serialNumber:"urn:uuid:00000000-0000-4000-8000-00000000a642",version:1,metadata:{timestamp,component:{type:"application",name:"YNX AI",version:"1.0.0-testnet-preview"},tools:{components:[{type:"application",name:"apps/ai/scripts/generate-sbom.mjs",version:"1"}]}},components:[...components.values()].sort((a,b)=>a.purl.localeCompare(b.purl))};
await writeFile(output,`${JSON.stringify(bom,null,2)}\n`);
console.log(JSON.stringify({ok:true,output,components:bom.components.length}));
