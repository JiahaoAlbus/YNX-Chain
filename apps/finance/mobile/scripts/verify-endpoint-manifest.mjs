import {readFile} from 'node:fs/promises';
import {bundledEndpointAuthority,selectAuthorityEndpoint,validateEndpointAuthority} from '@ynx-chain/sdk';
const pin=JSON.parse(await readFile(new URL('../contract/endpoint-authority-pin.json',import.meta.url),'utf8'));
const nowMs=Date.now(),authority=await validateEndpointAuthority(bundledEndpointAuthority,{trustedPin:pin,nowMs,source:'bundled'});
const selected={rpc:selectAuthorityEndpoint(authority,'rpc',{nowMs}),evmRpc:selectAuthorityEndpoint(authority,'evmRpc',{nowMs}),faucet:selectAuthorityEndpoint(authority,'faucet',{nowMs})};
if(selected.rpc!=='https://rpc-testnet.ynxweb4.com'||selected.evmRpc!==selected.rpc||selected.faucet!=='https://faucet-testnet.ynxweb4.com')throw new Error('Finance canonical endpoint selection drifted.');
if(authority.endpointStates.walletGateway.status!=='PENDING'||authority.endpointStates.products.finance.status!=='PENDING')throw new Error('Finance private services were promoted without independent authority.');
process.stdout.write(`Finance endpoint authority verified ${pin.payloadSha256}; Product Session remains PENDING\n`);
