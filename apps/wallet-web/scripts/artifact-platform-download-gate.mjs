import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const evidencePath=join(root,"evidence","runtime","built-platform-download-matrix-20260902.json");
const variants=["ynx-wallet-web-pwa-0.1.0.zip","ynx-wallet-chrome-edge-0.1.0.zip","ynx-wallet-firefox-0.1.0.zip"];
const unavailableKeys=["windowsX64","windowsArm64","macosX64","macosArm64","linuxX64","linuxArm64","chromeEdgeExtension","firefoxExtension","pwaPackage"];
const result={schemaVersion:1,sourceCommit:process.env.YNX_WALLET_WEB_SOURCE_COMMIT||"uncommitted-source-tree",generatedAt:new Date().toISOString(),gateClass:"exact built-artifact download metadata and UI-source inspection; an Android SPA fallback is explicitly unhosted and not an installation, platform package publication, or signing proof",artifacts:[],androidHosted:false,windowsX64Hosted:false,windowsArm64Hosted:false,macosX64Hosted:false,macosArm64Hosted:false,linuxX64Hosted:false,linuxArm64Hosted:false,chromeEdgeExtensionHosted:false,firefoxExtensionHosted:false,pwaPackageHosted:false,webArtifactDownloadHosted:false,installedLocal:false,deployedPublic:false,productionSigned:false,storeReleased:false,passed:false};

for(const name of variants){
  const archive=join(root,"artifacts",name),temp=await mkdtemp(join(tmpdir(),"ynx-platform-downloads-"));
  try{
    execFileSync("unzip",["-q",archive,"-d",temp]);
    const provider=await import(`${pathToFileURL(join(temp,"provider.js")).href}?variant=${encodeURIComponent(name)}-${Date.now()}`);
    const app=await readFile(join(temp,"app.js"),"utf8"),styles=await readFile(join(temp,"styles.css"),"utf8"),bytes=await readFile(archive),info=await stat(archive);
    const matrix=provider.WALLET_DOWNLOAD_MATRIX;
    const checks={
      androidSpaFallbackNeverAdvertised:matrix.android?.hosted===false&&matrix.android.url===null&&matrix.android.bytes===null&&matrix.android.sha256===null&&matrix.android.contentType===null&&matrix.android.signingClass==="unpublished"&&matrix.android.productionSigned===false&&matrix.android.publicStatusUrl==="https://www.ynxweb4.com/dapp/download"&&provider.YNX_DOWNLOAD_URL===null,
      unavailableNullRoutes:unavailableKeys.every(key=>matrix[key]?.hosted===false&&matrix[key]?.url===null),
      pwaStatusNotPackage:matrix.pwaPackage?.publicStatusUrl==="https://www.ynxweb4.com/dapp/wallet"&&matrix.pwaPackage?.hosted===false,
      inaccessibleLinksPrevented:/disabled aria-disabled="true" data-permanent-disabled="true"/u.test(app),
      androidMetadataTruthful:/aria-describedby="download-meta"/u.test(app)&&/PUBLIC_ARTIFACT_UNAVAILABLE/u.test(app)&&/androidDownloadControl/u.test(app),
      staleAndroidClaimAbsent:!/ynx-wallet-1\.0\.1-testnet-preview-dc31c9a8-test-signed\.apk/u.test(app)&&!/fd924ef853cf17d42ca2d36504528ef879c73fcb4b01ea72b1bfe7ae85085fef/u.test(app),
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
