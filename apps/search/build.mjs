import {cp,mkdir,rm} from "node:fs/promises";
import {resolve} from "node:path";
import {build} from "esbuild";

const root=import.meta.dirname;
const dist=resolve(root,"dist");
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
await build({
  entryPoints:[resolve(root,"src/public/app.js")],
  outfile:resolve(dist,"app.js"),
  bundle:true,
  format:"esm",
  platform:"browser",
  target:["es2022"],
  minify:true,
  sourcemap:false
});
for(const file of ["index.html","styles.css","runtime-config.js","sw.js"]){
  await cp(resolve(root,"src/public",file),resolve(dist,file));
}
