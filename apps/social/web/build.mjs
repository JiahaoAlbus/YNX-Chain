// Executed only by the authorized build/release owner, never by a source consumer.
import {build} from 'esbuild';
import {cp,mkdir,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url)),out=new URL('./dist/',import.meta.url);
const transports=JSON.parse(await readFile(new URL('./vendor/ynx-wallet-transports-manifest.json',import.meta.url)));
if(transports.schemaVersion!=='ynx-social-official-transports/v1'||!/^[a-f0-9]{40}$/.test(transports.sourceCommit)||transports.artifact!==`ynx-wallet-transports-${transports.sourceCommit.slice(0,9)}.mjs`)throw new Error('SOCIAL_TRANSPORT_MANIFEST_INVALID');
const transportBytes=await readFile(new URL('./vendor/'+transports.artifact,import.meta.url));if(transportBytes.length!==transports.bytes||createHash('sha256').update(transportBytes).digest('hex')!==transports.sha256)throw new Error('SOCIAL_TRANSPORT_BYTES_INVALID');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const path of ['index.html','styles.css','workspace.css','app.js','wallet-provider.js','wallet-transports.js','assets','vendor'])await cp(new URL(path,import.meta.url),new URL(path,out),{recursive:true});
// Frozen 6f registry already contains the exact five registered Social scopes.
// This keeps the build root self-contained; the legacy Web snapshot is untouched.
await cp(new URL('../src/vendor/product-session-registry.json',import.meta.url),new URL('vendor/product-session-registry.json',out));
await build({absWorkingDir:root,entryPoints:['private-session-ui.js'],outfile:fileURLToPath(new URL('private-session-ui.js',out)),bundle:true,platform:'browser',format:'esm',target:'es2022',minify:false});
