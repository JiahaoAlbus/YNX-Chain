import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {dirname,resolve,extname} from "node:path";
import {fileURLToPath} from "node:url";
import {compilePwaShell} from "./build.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),repository=resolve(root,"../..");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const git=(commit,path)=>execFileSync("git",["show",`${commit}:${path}`],{cwd:repository});
export async function historicalPwaFixture(commit){
  const sourceCommit=execFileSync("git",["rev-parse",commit],{cwd:repository,encoding:"utf8"}).trim();
  const build=git(commit,"apps/wallet-web/scripts/build.mjs").toString();
  const names=JSON.parse(build.match(/const pwaIntegrityFiles=(\[[^\n]+?\]),assetIntegrity=/u)?.[1]||"null");
  if(!Array.isArray(names))throw new Error("Historical PWA build inventory missing");
  const files={},coreCommit=build.match(/const coreCommit="([0-9a-f]+)"/u)[1],centralCallerCommit=build.match(/const centralCallerCommit="([0-9a-f]+)"/u)[1];
  const consumer=await import(`data:text/javascript;base64,${git(commit,"apps/wallet-web/src/core-auth-consumer.js").toString("base64")}`);
  const corePath="release/integration/wallet-auth-web-companion-registry-contract.json";
  const object=(ref,path)=>execFileSync("git",["rev-parse",`${ref}:${path}`],{cwd:repository,encoding:"utf8"}).trim();
  const binding=consumer.deriveWalletWebCompanionBinding(JSON.parse(git(coreCommit,corePath)),{coreCommit,coreContractBlob:object(coreCommit,corePath),centralCallerCommit,centralCallerBlob:object(centralCallerCommit,"release/integration/wallet-auth-android-launcher-contract.json"),publicGatewayRegistryReady:false,trustedRuntimeAvailable:false});
  const publicNames=new Set(["index.html","styles.css","accessibility.css","app.js","manifest.webmanifest","ynx-logo.png","ynx-icon-192.png","ynx-icon-512.png","ynx-icon-maskable-512.png"]);
  for(const name of names){
    if(name==="core-auth-binding.js")files[name]=Buffer.from(`export const CORE_WALLET_AUTH_BINDING=Object.freeze(${JSON.stringify(binding)});\n`);
    else if(name==="build-identity.json")files[name]=Buffer.from(JSON.stringify({schemaVersion:1,product:"YNX Wallet Companion",sourceCommit,providerAuthorityCommit:build.match(/const providerAuthorityCommit="([0-9a-f]+)"/u)[1],providerEvidenceCommit:"d3831c300560507f64a50e73117bab7b85926d9a",chainId:"0x1917"})+"\n");
    else files[name]=git(commit,`apps/wallet-web/${publicNames.has(name)?"public":"src"}/${name}`);
  }
  const integrity=Object.fromEntries(names.map(name=>[`./${name}`,sha(files[name])]));
  if(build.includes("navigationShellDigest")){
    files["index.html"]=Buffer.from(files["index.html"].toString().replace("</head>",`<meta name="ynx-wallet-shell" content="${sha(JSON.stringify(integrity))}">\n</head>`));
    integrity["./index.html"]=sha(files["index.html"]);
  }
  integrity["./"]=integrity["./index.html"];
  files["asset-integrity.js"]=Buffer.from(`export const ASSET_INTEGRITY=Object.freeze(${JSON.stringify(integrity)});\n`);
  // Do not replace this worker with a simplified seed worker. Its exact historic
  // install, fetch-purge, navigation-recovery and activation code runs in browser.
  files["sw.js"]=git(commit,"apps/wallet-web/public/sw.js");
  const policy=await import(`data:text/javascript;base64,${files["service-worker-policy.js"].toString("base64")}`);
  return {files,assetIntegrity:integrity,cache:policy.PWA_CACHE,sourceCommit,workerSha256:sha(files["sw.js"]),fixtureClass:"exact historical worker and source shell; generated historical build metadata"};
}

export async function createPwaUpgradeHarness({port=8787,candidate=null}={}){
  const integritySource=candidate?.files["asset-integrity.js"]??await readFile(resolve(root,"dist/pwa/asset-integrity.js"));
  const {ASSET_INTEGRITY}=await import(`data:text/javascript;base64,${Buffer.from(integritySource).toString("base64")}`);
  const files=candidate?.files??Object.fromEntries(await Promise.all([...new Set([...Object.keys(ASSET_INTEGRITY).filter(key=>key!=="./").map(key=>key.slice(2)),"sw.js","asset-integrity.js"])].map(async name=>[name,await readFile(resolve(root,"dist/pwa",name))])));
  for(const [key,expected] of Object.entries(ASSET_INTEGRITY))if(sha(files[key==="./"?"index.html":key.slice(2)])!==expected)throw new Error(`Built PWA integrity mismatch: ${key}`);
  const policy=await import(`data:text/javascript;base64,${files["service-worker-policy.js"].toString("base64")}`);
  const candidateA={files,assetIntegrity:ASSET_INTEGRITY,cache:policy.PWA_CACHE,workerSha256:sha(files["sw.js"]),fixtureClass:candidate?"unit-test supplied shell":"current exact dist/pwa"};
  const raw=Object.fromEntries(Object.keys(ASSET_INTEGRITY).filter(key=>key!=="./").map(key=>[key.slice(2),files[key.slice(2)]]));
  raw["service-worker-policy.js"]=Buffer.from(raw["service-worker-policy.js"].toString().replace(/export const PWA_BUILD_ID = "[0-9a-f]{64}";/u,'export const PWA_BUILD_ID = "__YNX_PWA_BUILD_ID__";'));
  raw["index.html"]=Buffer.from(raw["index.html"].toString().replace(/<meta name="ynx-wallet-shell" content="[0-9a-f]{64}">\n/u,""));
  raw["styles.css"]=Buffer.from(raw["styles.css"].toString()+"\n/* Local upgrade fixture B: asset-only build change. */\n");
  const b=compilePwaShell(raw,await readFile(resolve(root,"public/sw.js"),"utf8"));
  const candidateB={...b,cache:`ynx-wallet-shell-build-${b.buildId}`,workerSha256:sha(b.files["sw.js"]),fixtureClass:"current source with one harmless CSS fixture comment"};
  const bundles={"legacy-v8":await historicalPwaFixture("2f55f7924"),"legacy-v11":await historicalPwaFixture("27d00feb"),"candidate-a":candidateA,"candidate-b":candidateB};
  let phase="legacy-v8";
  const held=new Set(),requests=[];
  const metadata=()=>({phase,heldRequests:held.size,scope:"/wallet/",bundles:Object.fromEntries(Object.entries(bundles).map(([name,{cache,sourceCommit,workerSha256,fixtureClass,assetIntegrity}])=>[name,{cache,sourceCommit,workerSha256,fixtureClass,assetIntegrity}])),requests:requests.slice(-80),nativeWalletConnected:false,productSessionCreated:false});
  const server=createServer(async(request,response)=>{
    const route=new URL(request.url,"http://fixture").pathname;
    response.setHeader("cache-control","no-store");response.setHeader("x-content-type-options","nosniff");
    try{
      if(route==="/__state"){response.setHeader("content-type","application/json");response.end(JSON.stringify(metadata()));return}
      if(route==="/__phase"&&request.method==="POST"){
        let body="";for await(const chunk of request){body+=chunk;if(body.length>4096)throw new Error("Request too large")}
        const next=JSON.parse(body).phase;
        if(![...Object.keys(bundles),"candidate-b-broken","candidate-b-hold","network-failure"].includes(next))throw new Error("Unknown phase");
        phase=next;response.setHeader("content-type","application/json");response.end(JSON.stringify(metadata()));return;
      }
      if(route==="/__release"&&request.method==="POST"){
        phase="candidate-b";for(const pending of held){pending.writeHead(200,{"content-type":"text/css"});pending.end(candidateB.files["styles.css"])}held.clear();response.end("released");return;
      }
      if(route==="/"||route==="/harness.js"||route==="/harness.css"){
        const filename=route==="/"?"pwa-upgrade-harness.html":route==="/harness.js"?"pwa-upgrade-harness.js":"pwa-upgrade-harness.css";
        response.setHeader("content-type",route==="/"?"text/html; charset=utf-8":route.endsWith(".js")?"text/javascript":"text/css");
        response.end(await readFile(resolve(root,"scripts/fixtures",filename)));return;
      }
      if(!route.startsWith("/wallet/")){response.writeHead(404).end();return}
      const filename=route.slice("/wallet/".length)||"index.html";
      requests.push({phase,path:filename,mode:request.headers["sec-fetch-mode"]??null});
      const bundle=bundles[phase]??candidateB;
      if(phase==="network-failure"||(phase==="candidate-b-broken"&&filename==="app.js")){response.writeHead(503).end("Deliberate fixture network failure");return}
      if(phase==="candidate-b-hold"&&filename==="styles.css"){held.add(response);response.on("close",()=>held.delete(response));return}
      if(!Object.hasOwn(bundle.files,filename)){response.writeHead(404).end();return}
      response.setHeader("service-worker-allowed","/wallet/");
      response.setHeader("content-type",({".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css",".json":"application/json",".webmanifest":"application/manifest+json",".png":"image/png"})[extname(filename)]??"application/octet-stream");
      response.end(bundle.files[filename]);
    }catch(error){response.writeHead(400).end(error.message)}
  });
  await new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolveListen)});
  return {server,url:`http://127.0.0.1:${server.address().port}/`,metadata,close:()=>new Promise(resolveClose=>{for(const pending of held)pending.destroy();server.close(resolveClose)})};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {url,metadata}=await createPwaUpgradeHarness({port:Number(process.argv[2]||8787)});
  console.log(JSON.stringify({url,mode:"real browser Service Worker upgrade fixture; no provider or Auth operations",legacyV8WorkerSha256:metadata().bundles["legacy-v8"].workerSha256,candidateCache:metadata().bundles["candidate-a"].cache},null,2));
}
