import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Original Card runtime packaging, not a Current/role/custody producer.
 * External packages still require the original locked dependency installation.
 * A fresh output directory is mandatory: no overwrite or cleanup of releases.
 */
export async function buildCardBackend(outputDirectory){
 if(typeof outputDirectory!=='string'||!outputDirectory)throw Error('CARD_BACKEND_OUTPUT_REQUIRED');
 const output=resolve(outputDirectory);
 await mkdir(output,{recursive:false,mode:0o700});
 await mkdir(join(output,'server'));await mkdir(join(output,'vendor'));
 const registry='product-session-registry-b754ffc42.json';
 await copyFile(join(root,'vendor',registry),join(output,'vendor',registry));
 await build({entryPoints:[join(root,'server/main.ts')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:join(output,'server/main.cjs'),logLevel:'silent'});
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const files=[];
 for(const path of ['server/main.cjs','vendor/'+registry]){
  const bytes=await readFile(join(output,path));files.push({path,bytes:bytes.length,sha256:digest(bytes)});
 }
 const manifest={schemaVersion:1,sourceCommit,format:'commonjs',entry:'server/main.cjs',testedBuildNode:process.version,dependencyMode:'EXTERNAL_LOCKED_INSTALL_REQUIRED',packageLockSha256:digest(await readFile(join(root,'package-lock.json'))),files,privateRuntimeReady:false,productionRealPayments:false};
 await writeFile(join(output,'backend-files.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const argument=process.argv.slice(2);
 if(argument.length!==1||!argument[0].startsWith('--output-dir='))throw Error('Use --output-dir=<fresh-directory>');
 console.log(JSON.stringify(await buildCardBackend(argument[0].slice('--output-dir='.length)),null,2));
}
