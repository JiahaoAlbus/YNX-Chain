import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {prepareCurrentWalletSDK} from '../../seller-console/scripts/current-wallet-sdk.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const sdk=await prepareCurrentWalletSDK({dependencies:resolve(root,'node_modules')});
await rm(resolve(root,"dist"),{recursive:true,force:true});
await mkdir(resolve(root,"dist"),{recursive:true});
for(const file of ["index.html","styles.css","display-settings.js","manifest.webmanifest","runtime-config.js"]){await cp(resolve(root,"src",file),resolve(root,"dist",file))}
await cp(resolve(root,"src/assets"),resolve(root,"dist/assets"),{recursive:true});
await build({...sdk.buildOptions,entryPoints:[resolve(root,"src/app.js")],outfile:resolve(root,"dist/app.js"),bundle:true,minify:true,format:"esm",platform:"browser",target:["es2022"],sourcemap:false,legalComments:"eof"});
const bundle=await readFile(resolve(root,"dist/app.js"),"utf8");
if(/node:crypto|node:fs|node:path/.test(bundle))throw new Error("Browser bundle retained a Node-only dependency");
console.log("merchant console built: dist/ with canonical Wallet client");
