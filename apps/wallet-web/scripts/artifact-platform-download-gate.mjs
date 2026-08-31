import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const evidencePath=join(root,"evidence","runtime","built-platform-download-matrix-20260814.json");
const variants=["ynx-wallet-web-pwa-0.1.0.zip","ynx-wallet-chrome-edge-0.1.0.zip","ynx-wallet-firefox-0.1.0.zip"];
const androidUrl="https://www.ynxweb4.com/downloads/ynx-wallet-1.0.1-testnet-preview-dc31c9a8-test-signed.apk";
const unavailableKeys=["windowsX64","windowsArm64","macosX64","macosArm64","linuxX64","linuxArm64","chromeEdgeExtension","firefoxExtension","pwaPackage"];
const result={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),gateClass:"exact built-artifact download metadata and UI-source inspection; not browser installation, platform package publication, or signing proof",artifacts:[],androidHosted:true,windowsX64Hosted:false,windowsArm64Hosted:false,macosX64Hosted:false,macosArm64Hosted:false,linuxX64Hosted:false,linuxArm64Hosted:false,chromeEdgeExtensionHosted:false,firefoxExtensionHosted:false,pwaPackageHosted:false,webArtifactDownloadHosted:false,installedLocal:false,deployedPublic:false,productionSigned:false,storeReleased:false,passed:false};

for(const name of variants){
  const archive=join(root,"artifacts",name),temp=await mkdtemp(join(tmpdir(),"ynx-platform-downloads-"));
  try{
    execFileSync("unzip",["-q",archive,"-d",temp]);
    const provider=await import(`${pathToFileURL(join(temp,"provider.js")).href}?variant=${encodeURIComponent(name)}-${Date.now()}`);
    const app=await readFile(join(temp,"app.js"),"utf8"),styles=await readFile(join(temp,"styles.css"),"utf8"),bytes=await readFile(archive),info=await stat(archive);
    const matrix=provider.WALLET_DOWNLOAD_MATRIX;
    const checks={
      androidExact:matrix.android?.hosted===true&&matrix.android.url===androidUrl&&matrix.android.bytes===78392878&&matrix.android.sha256==="fd924ef853cf17d42ca2d36504528ef879c73fcb4b01ea72b1bfe7ae85085fef"&&matrix.android.contentType==="application/vnd.android.package-archive"&&matrix.android.signingClass==="persistent-testnet-release-key"&&matrix.android.productionSigned===false&&provider.YNX_DOWNLOAD_URL===androidUrl,
      unavailableNullRoutes:unavailableKeys.every(key=>matrix[key]?.hosted===false&&matrix[key]?.url===null),
      pwaStatusNotPackage:matrix.pwaPackage?.publicStatusUrl==="https://www.ynxweb4.com/dapp/wallet"&&matrix.pwaPackage?.hosted===false,
      inaccessibleLinksPrevented:/disabled aria-disabled="true" data-permanent-disabled="true"/u.test(app),
      androidMetadataVisible:/aria-describedby="download-meta"/u.test(app)&&/productionSigned=false/u.test(app),
      disabledStatePreserved:/button\.disabled = button\.dataset\.permanentDisabled === "true"/u.test(app),
      fallbackVisibilityBound:/#platforms/u.test(app)&&/showYNXDownload/u.test(app),
      narrowLayout:/@media\(max-width:520px\)[\s\S]*\.wallets,\.actions,\.platform-grid\{grid-template-columns:1fr\}/u.test(styles),
    };
    result.artifacts.push({name,bytes:info.size,sha256:createHash("sha256").update(bytes).digest("hex"),matrix,checks,passed:Object.values(checks).every(Boolean)});
  }finally{await rm(temp,{recursive:true,force:true});}
}
result.passed=result.artifacts.every(item=>item.passed);
await mkdir(dirname(evidencePath),{recursive:true});
await writeFile(evidencePath,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(result,null,2));
process.exit(result.passed?0:1);
