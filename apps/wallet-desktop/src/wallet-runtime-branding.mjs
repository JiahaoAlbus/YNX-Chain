import path from "node:path";
/** Public application identity only. Never patch Electron's installed bundle,
 * another QA process, user custody files or release version/provenance. */
export function configureWalletRuntimeBranding({app,Menu,nativeImage,directory}){
  const qa=!app.isPackaged,source=path.basename(path.resolve(app.getAppPath(),"../..")),icon=nativeImage.createFromPath(path.join(directory,"icon.png"));
  if(icon.isEmpty())throw Error("YNX_WALLET_BRAND_ICON_UNAVAILABLE");
  app.setName("YNX Wallet");
  app.setAboutPanelOptions({applicationName:"YNX Wallet",applicationVersion:app.getVersion(),iconPath:path.join(directory,"icon.png"),copyright:qa?`Local QA · Not an official release\nSource: ${source}`:"YNX Chain"});
  app.dock?.setIcon(icon);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:"YNX Wallet",submenu:[{role:"about",label:"About YNX Wallet"},{type:"separator"},{role:"hide"},{role:"hideOthers"},{role:"unhide"},{type:"separator"},{role:"quit",label:"Quit YNX Wallet"}]},
    {role:"editMenu"},{role:"viewMenu"},{role:"windowMenu"}
  ]));
  return Object.freeze({title:qa?"YNX Wallet · QA":"YNX Wallet",icon});
}
