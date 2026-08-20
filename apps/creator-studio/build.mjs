import {build} from "esbuild";
import {cp,mkdir,rm} from "node:fs/promises";
import {fileURLToPath} from "node:url";
const out=new URL("dist/",import.meta.url);
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
await build({entryPoints:[fileURLToPath(new URL("app.js",import.meta.url))],bundle:true,format:"esm",platform:"browser",target:["es2022"],outfile:fileURLToPath(new URL("app.js",out)),minify:true,sourcemap:false,legalComments:"none"});
for(const file of ["index.html","styles.css","enhancements.css","runtime-config.js"])await cp(new URL(file,import.meta.url),new URL(file,out));
console.log("Creator Studio production bundle built");
