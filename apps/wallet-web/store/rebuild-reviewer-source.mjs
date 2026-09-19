import {createHash} from "node:crypto";
import {readFile,writeFile,lstat,realpath,readdir} from "node:fs/promises";
import {resolve,join,sep} from "node:path";
import {fileURLToPath} from "node:url";

const root=await realpath(resolve(fileURLToPath(new URL("../../..",import.meta.url))));
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const manifest=JSON.parse(await readFile(join(root,"source-package.json"),"utf8"));
if(manifest.schemaVersion!==1||!/^[0-9a-f]{40}$/u.test(manifest.sourceCommit)||!Array.isArray(manifest.files)||!Array.isArray(manifest.expectedOutputs))throw new Error("Invalid source package manifest");
const seen=new Set();
for(const file of manifest.files){
  if(typeof file.path!=="string"||file.path.startsWith("/")||file.path.split("/").some(x=>!x||x==="."||x==="..")||seen.has(file.path))throw new Error("Invalid source path");seen.add(file.path);
  const path=join(root,file.path),actual=await realpath(path),bytes=await readFile(path);
  if(!actual.startsWith(root+sep)||(await lstat(path)).isSymbolicLink()||bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw new Error(`Source integrity mismatch: ${file.path}`);
}
async function checkDependencyLinks(directory){
  for(const item of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,item.name);
    if(item.isSymbolicLink()){if(!(await realpath(path)).startsWith(root+sep))throw new Error("External dependency symlink is not a self-contained rebuild");}
    else if(item.isDirectory())await checkDependencyLinks(path);
  }
}
for(const packagePath of ["apps/wallet-web/node_modules","packages/wallet-auth/node_modules"]){const path=join(root,packagePath);if((await lstat(path)).isSymbolicLink()||!(await realpath(path)).startsWith(root+sep))throw new Error("Dependencies must be installed inside the extracted archive");await checkDependencyLinks(path);}
const authorityFile=join(root,"build-authorities.json");
if(hash(await readFile(authorityFile))!==manifest.authorityArchiveSha256)throw new Error("Authority archive hash mismatch");
process.env.YNX_WALLET_WEB_SOURCE_COMMIT=manifest.sourceCommit;
process.env.YNX_WALLET_WEB_AUTHORITY_FILE=authorityFile;
const {buildAll}=await import("../scripts/build.mjs");
const output=join(root,"reviewer-output");await buildAll({dist:output,authorityFile});
const actualPaths=[];for(const variant of ["chromium","firefox","pwa"]){for(const file of await readdir(join(output,variant)))actualPaths.push(`${variant}/${file}`)}
if(JSON.stringify(actualPaths.sort())!==JSON.stringify(manifest.expectedOutputs.map(x=>x.path).sort()))throw new Error("Rebuilt file inventory mismatch");
for(const file of manifest.expectedOutputs){const bytes=await readFile(join(output,file.path));if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw new Error(`Rebuilt byte mismatch: ${file.path}`)}
const result={sourceCommit:manifest.sourceCommit,verifiedSourceFiles:seen.size,verifiedOutputFiles:actualPaths.length,authorityArchiveSha256:manifest.authorityArchiveSha256,gitRepositoryRequired:false,externalDependencySymlinks:false,allBytesMatch:true,installed:false,submitted:false};await writeFile(join(root,"rebuild-result.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));
