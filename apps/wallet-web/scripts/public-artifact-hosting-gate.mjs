import {mkdir,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {inspectOfficialArtifact} from "../src/public-artifact-hosting.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const evidencePath=join(root,"evidence","runtime","official-web-artifact-hosting-gate-20260814.json");
const expectUnhosted=process.argv.includes("--expect-unhosted");
const specs=[
  {name:"ynx-wallet-web-pwa-0.1.0.zip",url:"https://www.ynxweb4.com/downloads/ynx-wallet-web-pwa-0.1.0.zip",bytes:272706,sha256:"63d83cd20925f2d52c0f21f548fa7a857a4d056e03e5fa16244f173164a7d287"},
  {name:"ynx-wallet-chrome-edge-0.1.0.zip",url:"https://www.ynxweb4.com/downloads/ynx-wallet-chrome-edge-0.1.0.zip",bytes:188846,sha256:"c733093dea47c6612c8a9d5ecea40be2227f62402f4b4966955c9e1accf4e2aa"},
  {name:"ynx-wallet-firefox-0.1.0.zip",url:"https://www.ynxweb4.com/downloads/ynx-wallet-firefox-0.1.0.zip",bytes:188883,sha256:"417d9b9e5babf05fdfdf8161504389eb99c636be75f94444bf4ff91a9b4536b3"}
];
const artifacts=await Promise.all(specs.map(spec=>inspectOfficialArtifact(spec)));
const allHosted=artifacts.every(item=>item.hosted),allUnhosted=artifacts.every(item=>!item.hosted);
const result={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",observedAt:new Date().toISOString(),mode:expectUnhosted?"truthful-unhosted-monitor":"release-hosting-gate",artifacts,allHosted,allUnhosted,passed:expectUnhosted?allUnhosted:allHosted,browserVisibleAcceptance:false,deployedPublic:false,downloadHosted:allHosted,productionSigned:false,storeReleased:false};
await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));process.exit(result.passed?0:1);
