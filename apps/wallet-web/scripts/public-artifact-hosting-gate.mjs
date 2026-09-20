import {readFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {WALLET_DOWNLOAD_MATRIX} from "../src/provider.js";
import {inspectOfficialArtifact} from "../src/public-artifact-hosting.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const manifest=JSON.parse(await readFile(join(root,"artifact-manifest.json"),"utf8"));
const matrixEntries={
  "ynx-wallet-web-pwa-0.1.1.zip":WALLET_DOWNLOAD_MATRIX.pwaPackage,
  "ynx-wallet-chrome-edge-0.1.1.zip":WALLET_DOWNLOAD_MATRIX.chromeEdgeExtension,
  "ynx-wallet-firefox-0.1.1.zip":WALLET_DOWNLOAD_MATRIX.firefoxExtension,
};
const specs=manifest.artifacts.map(artifact=>{
  const entry=matrixEntries[artifact.name];
  if(!entry||entry.hosted!==true||!entry.url)throw new Error(`Published download matrix entry missing: ${artifact.name}`);
  if(entry.bytes!==artifact.bytes||entry.sha256!==artifact.sha256)throw new Error(`Published download matrix drift: ${artifact.name}`);
  return{name:artifact.name,url:entry.url,bytes:artifact.bytes,sha256:artifact.sha256,allowImmutableReleaseRedirect:true};
});
if(specs.length!==3)throw new Error("Expected three published Wallet Web artifacts");
const artifacts=await Promise.all(specs.map(spec=>inspectOfficialArtifact(spec)));
const allHosted=artifacts.every(item=>item.hosted);
const result={schemaVersion:2,sourceCommit:manifest.sourceCommit,observedAt:new Date().toISOString(),mode:"release-hosting-gate",artifacts,allHosted,passed:allHosted,browserVisibleAcceptance:false,deployedPublic:allHosted,downloadHosted:allHosted,productionSigned:false,storeReleased:false};
console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
