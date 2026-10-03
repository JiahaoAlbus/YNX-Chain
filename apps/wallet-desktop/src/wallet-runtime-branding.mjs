import path from "node:path";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
/** QA identity for public owned app files, not a commit or dependency/release attestation. */
export function readWalletQASourceFingerprint(directory){
  const files=readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isFile()&&/\.(?:mjs|cjs|js|html|css)$/.test(entry.name)).map(entry=>entry.name).sort();
  if(!["main.mjs","renderer.js","preload.cjs","index.html","styles.css"].every(name=>files.includes(name)))throw Error("QA_SOURCE_UNAVAILABLE");
  const hash=createHash("sha256");
  for(const name of ["../package.json",...files]){
    const bytes=readFileSync(path.join(directory,name));
    hash.update(name+"\0"+bytes.length+"\0").update(bytes);
  }
  return hash.digest("hex");
}
/** Public application identity only. Never patch Electron's installed bundle,
 * another QA process, user custody files or release version/provenance. */
export function configureWalletRuntimeBranding({app,Menu,nativeImage,directory,sourceFingerprint=readWalletQASourceFingerprint}){
  const qa=!app.isPackaged,source=path.basename(path.resolve(app.getAppPath(),"../..")),icon=nativeImage.createFromPath(path.join(directory,"icon.png"));
  if(icon.isEmpty())throw Error("YNX_WALLET_BRAND_ICON_UNAVAILABLE");
  let fingerprint;
  if(qa)try{const value=sourceFingerprint(directory);if(/^[0-9a-f]{64}$/.test(value))fingerprint=value}catch{}
  const qaLabel="测试构建 / QA",sourceLabel=fingerprint?fingerprint.slice(0,12):"源码未验证";
  app.setName("YNX Wallet");
  app.setAboutPanelOptions({applicationName:qa?`YNX Wallet · ${qaLabel}`:"YNX Wallet",applicationVersion:app.getVersion(),iconPath:path.join(directory,"icon.png"),copyright:qa?`Local QA · Not an official release\nSource: ${source}\nOwned app source SHA256: ${fingerprint??"NOT_VERIFIED"}\nNot a dependency or release attestation`:"YNX Chain"});
  app.dock?.setIcon(icon);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:"YNX Wallet",submenu:[{role:"about",label:"About YNX Wallet"},{type:"separator"},{role:"hide"},{role:"hideOthers"},{role:"unhide"},{type:"separator"},{role:"quit",label:"Quit YNX Wallet"}]},
    {role:"editMenu"},{role:"viewMenu"},{role:"windowMenu"}
  ]));
  return Object.freeze({title:qa?`YNX Wallet · ${qaLabel} · ${sourceLabel}`:"YNX Wallet",icon});
}
