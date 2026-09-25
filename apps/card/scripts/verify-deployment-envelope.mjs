import {execFileSync} from "node:child_process";
import {readdirSync,readFileSync,statSync} from "node:fs";
import {resolve,relative} from "node:path";
import {createHash} from "node:crypto";

const root=resolve(import.meta.dirname,"..");
const source=resolve(root,"dist-web");
const envelope=resolve(root,"deployment-envelope");
execFileSync(process.platform==="win32"?"npm.cmd":"npm",["run","build:web"],{cwd:envelope,stdio:"inherit"});
const files=(directory)=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const path=resolve(directory,entry.name);return entry.isDirectory()?files(path):[path];}).sort();
const sourceFiles=files(source).map(path=>relative(source,path));
const outputFiles=files(resolve(envelope,"dist-web")).map(path=>relative(resolve(envelope,"dist-web"),path));
if(JSON.stringify(sourceFiles)!==JSON.stringify(outputFiles))throw new Error("Nested Vercel output does not contain the exact static file set");
for(const path of sourceFiles){const left=readFileSync(resolve(source,path)),right=readFileSync(resolve(envelope,"dist-web",path));const hash=value=>createHash("sha256").update(value).digest("hex");if(left.length!==right.length||hash(left)!==hash(right))throw new Error(`Nested Vercel output mismatch: ${path}`);}
if(!statSync(resolve(envelope,"package.json")).isFile())throw new Error("Deployment envelope has no root package.json");
const sourceConfig=readFileSync(resolve(root,"vercel.json"));
const deployedConfig=readFileSync(resolve(envelope,"vercel.json"));
if(!sourceConfig.equals(deployedConfig))throw new Error("Deployment envelope must carry the exact Card Vercel configuration");
const configured=JSON.parse(deployedConfig.toString("utf8"));
const expected=[
  {source:"/api/card/v1/:path*",destination:"https://api.ynxweb4.com/api/card/v1/:path*"},
  {source:"/api/card/v2/:path*",destination:"https://api.ynxweb4.com/api/card/v2/:path*"},
  {source:"/wallet-auth/callback",destination:"/index.html"},
];
if(JSON.stringify(configured.rewrites)!==JSON.stringify(expected))throw new Error("Card routes must match the two narrow API proxies and exact Wallet callback");
console.log(`Verified nested static deployment envelope with ${sourceFiles.length} files.`);
