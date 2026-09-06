// Offline fixtures only. Public, deliberately known test key; never fund it.
// YNX_ETHERS_MODULE may point to an existing ethers install. No network is used.
const fs = require('node:fs');
const path = require('node:path');
const ethers = require(process.env.YNX_ETHERS_MODULE || 'ethers');
const signer = new ethers.Wallet('0x' + '46'.repeat(32));
const base = {type:0, chainId:6423, nonce:0, gasLimit:25000n, gasPrice:40000000000000n, to:'0x3535353535353535353535353535353535353535', value:2n*10n**18n};
const cases = {
  valid: {}, second: {nonce:1}, padded_gas: {gasLimit:30000n},
  wrong_chain: {chainId:1}, unprotected: {chainId:0},
  low_gas: {gasLimit:21000n}, excessive_gas: {gasLimit:30000001n},
  zero_price: {gasPrice:0n}, wrong_price: {gasPrice:40000000000001n},
  fractional: {value:1n}, zero_value: {value:0n},
  overflow: {value:(2n**63n-1n)*10n**18n},
  contract: {to:null}, calldata: {data:'0x12345678'}, self: {to:signer.address},
  type1: {type:1,accessList:[]}, type2: {type:2,gasPrice:undefined,maxFeePerGas:40000000000000n,maxPriorityFeePerGas:1n},
};
(async()=>{
  const vectors=[];
  for (const [name,patch] of Object.entries(cases)) {
    const raw=await signer.signTransaction({...base,...patch});
    vectors.push({name,raw,hash:ethers.keccak256(raw),sender:signer.address.toLowerCase(),valid:['valid','second','padded_gas'].includes(name)});
  }
  fs.writeFileSync(path.join(__dirname,'vectors.json'),JSON.stringify({generator:'ethers '+ethers.version,networkUsed:false,vectors},null,2)+'\n');
})();
