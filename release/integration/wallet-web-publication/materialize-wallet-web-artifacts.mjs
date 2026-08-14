import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
const acquisition=JSON.parse(await readFile(join(here,"artifact-acquisition.json"),"utf8"));
const outputFlag=process.argv.indexOf("--output-dir");
if(outputFlag<0||!process.argv[outputFlag+1])throw new Error("Usage: node materialize-wallet-web-artifacts.mjs --output-dir <isolated-directory>");
const outputDir=process.argv[outputFlag+1];
execFileSync("git",["cat-file","-e",`${acquisition.artifactCarrierCommit}^{commit}`]);
await mkdir(outputDir,{recursive:true});
const records=[];
for(const artifact of acquisition.artifacts){
  const object=`${acquisition.artifactCarrierCommit}:${artifact.gitPath}`;
  const body=execFileSync("git",["show",object],{maxBuffer:2_000_000});
  const observed={name:artifact.name,gitObject:object,bytes:body.length,sha256:createHash("sha256").update(body).digest("hex")};
  if(observed.bytes!==artifact.bytes||observed.sha256!==artifact.sha256)throw new Error(`Artifact integrity mismatch: ${artifact.name}`);
  const destination=join(outputDir,artifact.name);
  let existing=null;try{existing=await readFile(destination)}catch(error){if(error?.code!=="ENOENT")throw error}
  if(existing){
    const existingSha=createHash("sha256").update(existing).digest("hex");
    if(existing.length!==artifact.bytes||existingSha!==artifact.sha256)throw new Error(`Refusing to overwrite non-matching file: ${destination}`);
    observed.materialization="already-exact";
  }else{await writeFile(destination,body,{flag:"wx"});observed.materialization="created"}
  records.push(observed);
}
await writeFile(join(outputDir,"wallet-web-materialization.json"),`${JSON.stringify({schemaVersion:1,sourceCommit:acquisition.sourceCommit,artifactCarrierCommit:acquisition.artifactCarrierCommit,records},null,2)}\n`);
console.log(JSON.stringify({outputDir,records},null,2));
