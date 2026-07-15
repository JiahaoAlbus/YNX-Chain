import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");await rm(resolve(root,"dist"),{recursive:true,force:true});await mkdir(resolve(root,"dist"),{recursive:true});for(const file of ["index.html","styles.css","app.js","api.js","manifest.webmanifest"]){await cp(resolve(root,"src",file),resolve(root,"dist",file))}console.log("merchant console built: dist/");
