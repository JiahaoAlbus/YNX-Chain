const path=require("node:path");
const {realpathSync}=require("node:fs");
const {getDefaultConfig}=require("expo/metro-config");

const projectRoot=__dirname;
const repositoryRoot=path.resolve(projectRoot,"../..");
const config=getDefaultConfig(projectRoot);
// Metro needs the real targets of installed dependency links in its file map.
// Keep the installed graph; do not redirect packages to another SDK checkout.
const installedModules=realpathSync(path.join(projectRoot,"node_modules"));
const installedWalletAuth=realpathSync(path.join(projectRoot,"node_modules/@ynx-chain/wallet-auth"));
config.watchFolders=[...new Set([...(config.watchFolders??[]),repositoryRoot,installedModules,installedWalletAuth])];
config.resolver.nodeModulesPaths=[installedModules];
// Expo's development HMR rewrite resolves from projectRoot with an empty
// nodeModulesPaths list. Keep that rewrite on this same installed Expo package.
config.resolver.extraNodeModules={...(config.resolver.extraNodeModules??{}),expo:path.join(installedModules,"expo")};
const walletAuthRegistry=path.join(installedWalletAuth,"product-session-registry.json");
config.resolver.resolveRequest=(context,moduleName,platform)=>{
  if(moduleName==="../../../../packages/wallet-auth/product-session-registry.json"){
    return {filePath:walletAuthRegistry,type:"sourceFile"};
  }
  return context.resolveRequest(context,moduleName,platform);
};
module.exports=config;
