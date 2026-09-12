import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {RpcCoreAuthority} from './core.ts';
import {unavailableWallet,unavailableCore,type WalletAuthority} from './contracts.ts';
import {createCardServer} from './http.ts';
import {withCardApplicationVerifier} from './walletApproval.ts';
async function main(){
  const encoded=process.env.YNX_CARD_STATE_KEY_BASE64??'',key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw Error('Set YNX_CARD_STATE_KEY_BASE64 to a securely generated 32-byte base64 key');
  const database=resolve(process.env.YNX_CARD_DATA_DIR??'.card-data','card.sqlite');const store=new CardStore(database,key);key.fill(0);
  let wallet:WalletAuthority=unavailableWallet;const adapter=process.env.YNX_CARD_AUTH_ADAPTER_MODULE;
  if(adapter){const module=await import(pathToFileURL(resolve(adapter)).href);const authentication=await module.createWalletAuthority({origin:'https://wallet-auth.ynxweb4.com'});if(typeof authentication.authenticate!=='function')throw Error('Invalid accepted Wallet server authentication adapter');wallet=withCardApplicationVerifier(authentication)}
  const rpc=process.env.YNX_CARD_CORE_RPC_URL,recipient=process.env.YNX_CARD_TESTNET_FUNDING_ADDRESS;
  const core=rpc?new RpcCoreAuthority(rpc):unavailableCore;
  const service=new CardService({store,wallet,core,fundingAddress:recipient,minConfirmations:Number(process.env.YNX_CARD_MIN_CONFIRMATIONS??'2')});
  const server=createCardServer({service,wallet,sourceCommit:process.env.YNX_CARD_SOURCE_COMMIT??'unbound-development',allowedOrigin:process.env.YNX_CARD_ALLOWED_ORIGIN??'https://card.ynxweb4.com',configurationReady:Boolean(adapter&&rpc&&recipient)});
  const port=Number(process.env.YNX_CARD_PORT??'3094');if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Invalid YNX_CARD_PORT');
  server.listen(port,process.env.YNX_CARD_HOST??'127.0.0.1',()=>console.log(JSON.stringify({service:'ynx-card-business-backend',port,environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',productionRealPayments:false})));
  const stop=()=>server.close(()=>{store.close();process.exitCode=0});process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Card backend failed to start');process.exitCode=1});
