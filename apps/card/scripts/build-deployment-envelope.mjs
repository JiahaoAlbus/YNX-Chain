import {cpSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

const root=resolve(import.meta.dirname,"..");
const source=resolve(root,"dist-web");
const envelope=resolve(root,"deployment-envelope");
rmSync(envelope,{recursive:true,force:true});
mkdirSync(envelope,{recursive:true});
cpSync(source,resolve(envelope,"dist-web"),{recursive:true});
const manifest=JSON.parse(readFileSync(resolve(root,"static-deploy-package.json"),"utf8"));
manifest.scripts={"build:web":"node build-static.mjs"};
writeFileSync(resolve(envelope,"package.json"),`${JSON.stringify(manifest,null,2)}\n`);
writeFileSync(resolve(envelope,"build-static.mjs"),"import {accessSync} from 'node:fs';\naccessSync('dist-web/index.html');\n");
