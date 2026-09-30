import { createRequire } from "node:module";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { PrivateFilePolicy } from "./platform-private-file.mjs";
const require = createRequire(import.meta.url);
const { KeyValueStorage } = require("@walletconnect/keyvaluestorage");
// The pinned SDK database option is an fs-lite base directory, not a file.
// Preserve its format and protect actual records; never expose SDK secrets.
export async function createPrivateWalletConnectStorage(database, policy = new PrivateFilePolicy()) {
  if(typeof database !== "string" || !path.isAbsolute(database))throw new Error("WalletConnect profile storage requires an absolute path");
  await policy.directory(database);
  const secureTree = async (directory, harden = false) => {
    const entry=await lstat(directory);
    if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error("WalletConnect storage directory identity changed");
    if(process.platform !== "win32") {
      if(entry.uid!==process.getuid())throw new Error("WalletConnect storage owner changed");
      if(harden){const h=await open(directory,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_DIRECTORY);try{const actual=await h.stat();if(actual.dev!==entry.dev||actual.ino!==entry.ino)throw new Error("WalletConnect directory changed");await h.chmod(0o700)}finally{await h.close()}}
      else if((entry.mode&0o077)!==0)throw new Error("WalletConnect storage directory is not private");
    }else await policy.directory(directory);
    for(const child of await readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,child.name),stat=await lstat(file);
      if(stat.isDirectory()&&!stat.isSymbolicLink()){await secureTree(file,harden);continue}
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error("WalletConnect storage file identity changed");
      if(process.platform!=="win32"&&stat.uid!==process.getuid())throw new Error("WalletConnect storage owner changed");
      if(harden&&process.platform!=="win32") {
        const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{const actual=await h.stat();if(!actual.isFile()||actual.nlink!==1||actual.dev!==stat.dev||actual.ino!==stat.ino)throw new Error("WalletConnect file changed");await h.chmod(0o600);await policy.assertPrivate(file,await h.stat())}finally{await h.close()}
      }else{if(harden)await policy.protect(file);await policy.assertPrivate(file,stat)}
    }
  };
  await secureTree(database);
  let sdk,queue=Promise.resolve();
  const operation=(method,args)=>{
    const work=queue.then(async()=>{
      await secureTree(database);
      if(!sdk){sdk=new KeyValueStorage({database});await sdk.getKeys();await secureTree(database,true)}
      const result=await sdk[method](...args);
      await secureTree(database,true);return result;
    });queue=work.catch(()=>{});return work;
  };
  return Object.freeze(Object.fromEntries(["getKeys","getEntries","getItem","setItem","removeItem"].map(method=>[method,(...args)=>operation(method,args)])));
}
