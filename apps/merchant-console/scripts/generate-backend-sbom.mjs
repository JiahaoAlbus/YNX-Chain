import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repoRoot=resolve(appRoot,"../..");
const output=resolve(appRoot,"artifacts/sbom/backend.cdx.json");
const raw=execFileSync("go",["list","-m","-json","all"],{cwd:repoRoot,encoding:"utf8"});
const modules=[];
for(const chunk of raw.trim().split(/\n}\n(?={)/)){modules.push(JSON.parse(chunk.endsWith("}")?chunk:chunk+"}"))}
const sums=new Map();
for(const line of (await readFile(resolve(repoRoot,"go.sum"),"utf8")).split("\n")){
  const [path,version,sum]=line.trim().split(/\s+/);
  if(path&&version&&sum?.startsWith("h1:")&&!version.endsWith("/go.mod"))sums.set(`${path}@${version}`,Buffer.from(sum.slice(3),"base64").toString("hex"));
}
const ref=m=>m.Main?"pkg:golang/github.com/JiahaoAlbus/YNX-Chain":`pkg:golang/${m.Path}@${m.Version}`;
const components=modules.filter(m=>!m.Main).map(m=>{
  const component={"bom-ref":ref(m),type:"library",group:m.Path.includes("/")?m.Path.slice(0,m.Path.lastIndexOf("/")):"",name:m.Path.includes("/")?m.Path.slice(m.Path.lastIndexOf("/")+1):m.Path,version:m.Version,purl:ref(m),scope:"required",properties:[{name:"ynx:go:module-path",value:m.Path},{name:"ynx:go:indirect",value:String(Boolean(m.Indirect))}]};
  const hash=sums.get(`${m.Path}@${m.Version}`);if(hash)component.hashes=[{alg:"SHA-256",content:hash}];
  if(m.GoVersion)component.properties.push({name:"ynx:go:version",value:m.GoVersion});
  if(m.Replace)component.properties.push({name:"ynx:go:replace",value:`${m.Replace.Path}@${m.Replace.Version??"local-unversioned"}`});
  return component;
}).sort((a,b)=>a.purl.localeCompare(b.purl));
const refs=new Set(["pkg:golang/github.com/JiahaoAlbus/YNX-Chain",...components.map(v=>v["bom-ref"])]);
const graph=execFileSync("go",["mod","graph"],{cwd:repoRoot,encoding:"utf8"}).trim().split("\n");
const edges=new Map();for(const line of graph){const [from,to]=line.split(" ");if(!from||!to)continue;const fromRef=from.startsWith("github.com/JiahaoAlbus/YNX-Chain@")?"pkg:golang/github.com/JiahaoAlbus/YNX-Chain":`pkg:golang/${from}`;const toRef=`pkg:golang/${to}`;if(refs.has(fromRef)&&refs.has(toRef)){if(!edges.has(fromRef))edges.set(fromRef,new Set());edges.get(fromRef).add(toRef)}}
const dependencies=[...refs].sort().map(value=>({ref:value,dependsOn:[...(edges.get(value)??[])].sort()}));
const goMod=await readFile(resolve(repoRoot,"go.mod"));const goSum=await readFile(resolve(repoRoot,"go.sum"));
const bom={bomFormat:"CycloneDX",specVersion:"1.5",version:1,metadata:{lifecycles:[{phase:"build"}],tools:[{vendor:"YNX Chain",name:"generate-backend-sbom.mjs",version:"1"}],component:{"bom-ref":"pkg:golang/github.com/JiahaoAlbus/YNX-Chain",type:"application",name:"YNX-Chain",version:"unreleased",purl:"pkg:golang/github.com/JiahaoAlbus/YNX-Chain"},properties:[{name:"ynx:source",value:"go list -m -json all + go mod graph + go.sum"},{name:"ynx:paths",value:"excluded"},{name:"ynx:go.mod:sha256",value:createHash("sha256").update(goMod).digest("hex")},{name:"ynx:go.sum:sha256",value:createHash("sha256").update(goSum).digest("hex")}]},components,dependencies};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(bom,null,2)+"\n");
const digest=createHash("sha256").update(await readFile(output)).digest("hex");
console.log(`backend CycloneDX SBOM: ${components.length} components sha256=${digest}`);
