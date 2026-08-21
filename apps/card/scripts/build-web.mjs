import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

const root=resolve(import.meta.dirname,"..");
execFileSync(process.platform==="win32"?"npx.cmd":"npx",["expo","export","--platform","web","--output-dir","dist-web"],{cwd:root,stdio:"inherit"});
const indexPath=resolve(root,"dist-web/index.html");
const index=readFileSync(indexPath,"utf8");
if(!index.includes("/manifest.webmanifest"))writeFileSync(indexPath,index.replace("</head>","  <link rel=\"manifest\" href=\"/manifest.webmanifest\" />\n  <meta name=\"theme-color\" content=\"#002FA7\" />\n  <meta name=\"description\" content=\"YNX Card Testnet payment simulation. No fiat, real card payments, PAN, CVV, or merchant acceptance.\" />\n  <script defer src=\"/pwa-register.js\"></script>\n</head>"));
