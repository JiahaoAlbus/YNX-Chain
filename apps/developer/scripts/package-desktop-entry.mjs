import {build} from 'esbuild';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const developer=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// The entry is relocated from desktop/ to Resources/. Resolve its REAL static
// dependency graph at build time; copying source-relative imports is invalid.
// Dynamic runtime paths remain anchored to the packaged import.meta.url.
export async function packageDesktopEntry(output) {
 if(resolve(output)!==output||!output.endsWith('/Resources/server.mjs'))throw Error('Exact new Resources/server.mjs output required.');
 const parent=await lstat(dirname(output));if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('Regular new resources directory required.');
 const compiled=await build({entryPoints:[resolve(developer,'desktop/code-server.mjs')],absWorkingDir:developer,bundle:true,write:false,format:'esm',platform:'node',target:'node24',packages:'external',metafile:true,logLevel:'silent'});
 const bytes=compiled.outputFiles[0].contents,inputs=[];
 for(const name of Object.keys(compiled.metafile.inputs)){
  const path=resolve(developer,name);if(!path.startsWith(developer))throw Error('Desktop entry source escaped Developer.');
  const original=await readFile(path);inputs.push({path:relative(developer,path),bytes:original.length,sha256:hash(original)});
 }
 await writeFile(output,bytes,{flag:'wx',mode:0o644}); // Never hot-replace a package.
 return {schemaVersion:1,path:'Contents/Resources/server.mjs',sha256:hash(bytes),bytes:bytes.length,staticSourceInputs:inputs};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await packageDesktopEntry(process.argv[2])));
