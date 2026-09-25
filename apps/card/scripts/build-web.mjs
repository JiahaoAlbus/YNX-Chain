import {execFileSync} from "node:child_process";
import {readFileSync,rmSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

const root=resolve(import.meta.dirname,"..");
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const sourceTree=execFileSync("git",["rev-parse","HEAD^{tree}"],{cwd:root,encoding:"utf8"}).trim();
if(!/^[0-9a-f]{40}$/.test(sourceCommit)||!/^[0-9a-f]{40}$/.test(sourceTree))throw new Error("Card static runtime identity requires an exact Git source commit and tree");
rmSync(resolve(root,"dist-web"),{recursive:true,force:true});
execFileSync(process.platform==="win32"?"npx.cmd":"npx",["expo","export","--platform","web","--output-dir","dist-web"],{cwd:root,stdio:"inherit"});
const indexPath=resolve(root,"dist-web/index.html");
const index=readFileSync(indexPath,"utf8");
if(!index.includes("/manifest.webmanifest"))writeFileSync(indexPath,index.replace("</head>","  <meta name=\"google\" content=\"notranslate\" />\n  <link rel=\"manifest\" href=\"/manifest.webmanifest\" />\n  <meta name=\"theme-color\" content=\"#002FA7\" />\n  <meta name=\"description\" content=\"YNX Card Testnet payment simulation. No fiat, real card payments, PAN, CVV, or merchant acceptance.\" />\n  <script>document.documentElement.lang=\"en\";document.documentElement.setAttribute(\"translate\",\"no\");document.documentElement.classList.add(\"notranslate\");</script>\n  <script defer src=\"/pwa-register.js\"></script>\n</head>"));
writeFileSync(resolve(root,"dist-web/package.json"),readFileSync(resolve(root,"static-deploy-package.json"),"utf8"));
writeFileSync(resolve(root,"dist-web/runtime-identity.json"),`${JSON.stringify({schemaVersion:"ynx.card.runtime-identity.v1",productId:"ynx-card",sourceCommit,sourceTree,environment:"testnet",evmChainId:6423,evmChainHex:"0x1917",paymentNetwork:"simulation",productionRealPayments:false},null,2)}\n`);
