import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {copyFile,mkdir,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const PACKAGE_FILES=Object.freeze([
  "deploy/testnet-alias-only/aliases.caddy",
  "deploy/testnet-alias-only/aliases.nginx.conf",
  "deploy/testnet-alias-only/README.md",
  "deploy/testnet-alias-only/operator-inputs.request.json",
  "deploy/testnet-alias-only/faucet-cors.env",
]);
const git=(root,...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");

export async function buildPackage({root,output,sourceCommit,withFaucet=false}) {
  root=await realpath(root);
  if (!/^[0-9a-f]{40}$/.test(sourceCommit) || git(root,"rev-parse","HEAD")!==sourceCommit) throw new Error("exact checkout source commit required");
  if (git(root,"status","--porcelain=v1")) throw new Error("source checkout must be clean");
  const parent=await realpath(path.dirname(path.resolve(output)));
  output=path.join(parent,path.basename(output));
  if (output===root || output.startsWith(root+path.sep) || existsSync(output)) throw new Error("output must be a new directory outside the source tree");
  const records=[];
  for (const file of PACKAGE_FILES) {
    const actual=await realpath(path.join(root,file));
    if (actual!==path.join(root,file)) throw new Error("package inputs cannot be symlinks");
    const bytes=await readFile(actual);
    const committed=execFileSync("git",["show",`${sourceCommit}:${file}`],{cwd:root});
    if (!bytes.equals(committed)) throw new Error(`package source drift: ${file}`);
    records.push({sourcePath:file,filename:path.basename(file),sha256:sha256(bytes),bytes:bytes.length});
  }
  // All source checks precede output creation; existing outputs are never reused.
  await mkdir(output);
  for (const record of records) await copyFile(path.join(root,record.sourcePath),path.join(output,record.filename),1);
  const builtAt=new Date().toISOString();
  const artifacts=[];
  if (withFaucet) {
    for (const arch of ["amd64","arm64"]) {
      const filename=`ynx-faucetd-linux-${arch}`;
      execFileSync("go",["build","-mod=readonly","-trimpath","-buildvcs=false","-ldflags",`-s -w -X main.buildCommit=${sourceCommit} -X main.buildRelease=faucet-health-${sourceCommit.slice(0,9)} -X main.buildTime=${builtAt}`,"-o",path.join(output,filename),"./cmd/ynx-faucetd"],{cwd:root,env:{...process.env,CGO_ENABLED:"0",GOOS:"linux",GOARCH:arch,GOWORK:"off"},timeout:180000,stdio:["ignore","ignore","pipe"]});
      const bytes=await readFile(path.join(output,filename));
      artifacts.push({filename,os:"linux",arch,bytes:bytes.length,sha256:sha256(bytes),sourceCommit});
    }
  }
  if (git(root,"rev-parse","HEAD")!==sourceCommit || git(root,"status","--porcelain=v1")) throw new Error(`source changed; incomplete package retained at ${output}`);
  for (const record of records) if (sha256(await readFile(path.join(root,record.sourcePath)))!==record.sha256) throw new Error("input changed while packaging");
  const manifest={schema:"ynx-testnet-alias-only-package/v1",sourceCommit,sourceTree:git(root,"rev-parse","HEAD^{tree}"),builtAt,
    chainId:6423,nativeSymbol:"YNXT",mainnetEnabled:false,publicDeployed:false,publicVerified:false,
    dnsChangeAuthorized:false,consumerActivationAllowed:false,rollbackReady:false,
    rollbackReason:"operator must capture the existing ingress, DNS and binary before any change",files:records,artifacts};
  const manifestText=JSON.stringify(manifest,null,2)+"\n";
  await writeFile(path.join(output,"package-manifest.json"),manifestText,{flag:"wx"});
  const sums=[...records,...artifacts,{filename:"package-manifest.json",sha256:sha256(manifestText)}].map(x=>`${x.sha256}  ${x.filename}`).join("\n")+"\n";
  await writeFile(path.join(output,"SHA256SUMS"),sums,{flag:"wx"});
  return {output,manifest};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2); const options={root:path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..")};
  for (let i=0;i<args.length;i++) {
    if (args[i]==="--with-faucet") options.withFaucet=true;
    else if (args[i]==="--output" && args[i+1]) options.output=args[++i];
    else if (args[i]==="--source-commit" && args[i+1]) options.sourceCommit=args[++i];
    else throw new Error("Usage: build-testnet-alias-package.mjs --source-commit <exact-sha> --output <new-external-dir> [--with-faucet]");
  }
  if (!options.output || !options.sourceCommit) throw new Error("source commit and new output directory required");
  console.log(JSON.stringify(await buildPackage(options),null,2));
}
