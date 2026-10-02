const path=require("node:path");
const {getDefaultConfig}=require("expo/metro-config");

const projectRoot=__dirname;
const repositoryRoot=path.resolve(projectRoot,"../..");
const config=getDefaultConfig(projectRoot);
config.watchFolders=[...(config.watchFolders??[]),repositoryRoot];
config.resolver.nodeModulesPaths=[path.join(projectRoot,"node_modules")];
const walletAuthRegistry=path.join(projectRoot,"node_modules/@ynx-chain/wallet-auth/product-session-registry.json");
config.resolver.resolveRequest=(context,moduleName,platform)=>{
  if(moduleName==="../../../../packages/wallet-auth/product-session-registry.json"){
    return {filePath:walletAuthRegistry,type:"sourceFile"};
  }
  return context.resolveRequest(context,moduleName,platform);
};
module.exports=config;
