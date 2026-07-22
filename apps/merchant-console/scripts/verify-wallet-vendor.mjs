import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const archive=resolve(appRoot,"vendor/ynx-chain-wallet-auth-1.0.0.tgz");
const output=resolve(appRoot,"artifacts/vendor/wallet-auth-verification.json");
const sha=value=>createHash("sha256").update(value).digest("hex");
const entries=execFileSync("tar",["-tzf",archive],{encoding:"utf8"}).trim().split("\n").filter(v=>v&&!v.endsWith("/")).sort();
const files=entries.map(path=>({path,sha256:sha(execFileSync("tar",["-xOzf",archive,path]))}));
const metadata=JSON.parse(execFileSync("tar",["-xOzf",archive,"package/package.json"],{encoding:"utf8"}));
const result={schemaVersion:1,classification:"local-vendored-package-verification",package:{name:metadata.name,version:metadata.version,private:metadata.private===true,engines:metadata.engines??{},dependencies:metadata.dependencies??{}},archive:{fileName:"ynx-chain-wallet-auth-1.0.0.tgz",sha256:sha(await readFile(archive)),bytes:(await readFile(archive)).byteLength},contents:{fileCount:files.length,files},provenance:{sourceRepository:null,sourceCommit:null,status:"unverified"},license:{declared:null,inArchive:entries.some(v=>/(^|\/)(licen[cs]e|copying)(\.|$)/i.test(v)),status:"NOASSERTION"},limitations:["No source repository or source commit is declared by the archive.","No license file or declared license is present in the archive; distribution approval remains blocked."]};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(result,null,2)+"\n");
console.log(`Wallet Auth vendor verification: ${files.length} files sha256=${result.archive.sha256} license=${result.license.status}`);
