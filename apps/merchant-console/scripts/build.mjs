import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
await rm(resolve(root,"dist"),{recursive:true,force:true});
await mkdir(resolve(root,"dist"),{recursive:true});
for(const file of ["index.html","styles.css","a11y.css","manifest.webmanifest","runtime-config.js"]){await cp(resolve(root,"src",file),resolve(root,"dist",file))}
await build({entryPoints:[resolve(root,"src/app.js")],outfile:resolve(root,"dist/app.js"),bundle:true,minify:true,format:"esm",platform:"browser",target:["es2022"],sourcemap:false,legalComments:"eof"});
console.log("merchant console built: dist/ with canonical Wallet client");
