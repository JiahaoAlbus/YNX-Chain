import {createHash} from "node:crypto";
import {lstatSync, readFileSync, readdirSync, realpathSync} from "node:fs";
import {resolve, relative, sep} from "node:path";
import {pathToFileURL} from "node:url";

// A supplies a frozen, independently admitted receipt, not one generated from
// the candidate being verified. This gate does not authorize publication.
export function verifyReleaseArtifacts(rootPath, receipt) {
  const root=realpathSync(rootPath);
  const fail=(message)=>{throw new Error(`Card release rejected: ${message}`);};
  const hex40=/^[a-f0-9]{40}$/;
  if(receipt?.schemaVersion!=="ynx.card.release-artifacts.v1" ||
     !hex40.test(receipt.sourceCommit||"") || !hex40.test(receipt.sourceTree||"") ||
     typeof receipt.appVersion!=="string" || !receipt.appVersion ||
     receipt.canonicalURL!=="https://card.ynxweb4.com/" ||
     !Array.isArray(receipt.files) || !receipt.files.length) fail("invalid admitted receipt");
  const actual=new Map();
  function walk(dir) {
    for(const name of readdirSync(dir)) {
      const path=resolve(dir,name), stat=lstatSync(path);
      if(stat.isSymbolicLink())fail("symlinks are not admitted");
      if(stat.isDirectory())walk(path);
      else if(stat.isFile())actual.set(relative(root,path).split(sep).join("/"),path);
      else fail("unsupported artifact");
    }
  }
  walk(root);
  const expected=new Set();
  for(const file of receipt.files) {
    if(typeof file.path!=="string" || !file.path || file.path.startsWith("/") ||
       file.path.includes("\\") || file.path.split("/").some(part=>!part||part==="."||part==="..") ||
       expected.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256||"") ||
       !Number.isSafeInteger(file.bytes) || file.bytes<0) fail("invalid or duplicate artifact path");
    expected.add(file.path);
    const path=actual.get(file.path);
    if(!path)fail(`missing ${file.path}`);
    const bytes=readFileSync(path);
    if(bytes.length!==file.bytes || createHash("sha256").update(bytes).digest("hex")!==file.sha256)
      fail(`artifact mismatch ${file.path}`);
  }
  if(actual.size!==expected.size)fail("unexpected artifact: inventory must be exact");
  for(const path of ["index.html","runtime-identity.json","manifest.webmanifest","sw.js","pwa-register.js"])
    if(!expected.has(path))fail(`missing required product artifact ${path}`);
  const identity=JSON.parse(readFileSync(actual.get("runtime-identity.json"),"utf8"));
  if(identity.productId!=="ynx-card" || identity.sourceCommit!==receipt.sourceCommit ||
     identity.sourceTree!==receipt.sourceTree || identity.appVersion!==receipt.appVersion ||
     identity.releaseChannel!=="testnet-release" || identity.environment!=="testnet" ||
     identity.evmChainId!==6423 || identity.evmChainHex!=="0x1917" ||
     identity.paymentNetwork!=="simulation" || identity.productionRealPayments!==false)
    fail("source/version/channel/Testnet identity mismatch (QA is not a formal release)");
  const html=readFileSync(actual.get("index.html"),"utf8");
  if(!/<html\b[^>]*\blang=["']en["']/i.test(html) || !html.includes("YNX Card"))fail("wrong product shell or default language");
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match=>match[1]);
  if(!scripts.some(src=>src.startsWith("/_expo/static/js/web/")))fail("missing Card application bundle");
  for(const src of scripts) {
    if(!src.startsWith("/") || src.startsWith("//") || !expected.has(src.slice(1)))fail("unbound script in product shell");
  }
  return {status:"ARTIFACT_PARITY_ONLY",sourceCommit:identity.sourceCommit,sourceTree:identity.sourceTree,
    appVersion:identity.appVersion,filesVerified:expected.size,publicBusinessVerified:false,publicationAuthorized:false};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==4)throw new Error("Usage: node verify-release-artifacts.mjs <static-root> <admitted-receipt.json>");
  console.log(JSON.stringify(verifyReleaseArtifacts(process.argv[2],JSON.parse(readFileSync(process.argv[3],"utf8"))),null,2));
}
