import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const port=4273;
const child=spawn(process.execPath,[fileURLToPath(new URL("server.mjs",import.meta.url))],{env:{...process.env,PORT:String(port)}});
try {
  let response;
  for(let attempt=0;attempt<30;attempt++){
    try{response=await fetch(`http://127.0.0.1:${port}/?video=vid_test`);if(response.ok)break}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!response?.ok||!(await response.text()).includes("YNX Video"))throw new Error("viewer smoke failed");
  const wallet=await fetch(`http://127.0.0.1:${port}/wallet-connection.js`);
  if(!wallet.ok||!(await wallet.text()).includes("connectVideoWallet"))throw new Error("Standard Wallet consumer unavailable");
  const provider=await fetch(`http://127.0.0.1:${port}/ynx-dapp-connect-sdk/provider.js`);
  if(!provider.ok||!(await provider.text()).includes("StandardWalletConnection"))throw new Error("Accepted EIP-1193 provider module unavailable");
  console.log("viewer smoke ok");
} finally { child.kill(); }
