import {dirname,resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {RpcCoreAuthority} from './core.ts';
import {unavailableWallet,unavailableCore,type WalletAuthority} from './contracts.ts';
import {createCardServer} from './http.ts';
import {withCardApplicationVerifier} from './walletApproval.ts';
import {createWalletAuthority} from './sharedWalletAuth.ts';
import {CardProviderRegistry} from './providerRegistry.ts';
import {CardProviderApplications} from './providerApplication.ts';
import {ImmersveSandbox} from './immersveSandbox.ts';
import {CardProviderLifecycle,parseIssuingPrograms} from './providerLifecycle.ts';
import {CardFinanceRead} from './cardFinanceRead.ts';
async function main(){
  const encoded=process.env.YNX_CARD_STATE_KEY_BASE64??'',key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw Error('Set YNX_CARD_STATE_KEY_BASE64 to a securely generated 32-byte base64 key');
  const database=resolve(process.env.YNX_CARD_DATA_DIR??'.card-data','card.sqlite');const store=new CardStore(database,key);key.fill(0);
  let wallet:WalletAuthority=unavailableWallet;const adapter=process.env.YNX_CARD_AUTH_ADAPTER_MODULE;
  if(adapter){if(resolve(adapter)!==resolve(dirname(process.argv[1]??''),'sharedWalletAuth.ts'))throw Error('Card requires its pinned shared Wallet authentication consumer');wallet=withCardApplicationVerifier(createWalletAuthority())}
  const rpc=process.env.YNX_CARD_CORE_RPC_URL,recipient=process.env.YNX_CARD_TESTNET_FUNDING_ADDRESS;
  const core=rpc?new RpcCoreAuthority(rpc):unavailableCore;
  const service=new CardService({store,wallet,core,fundingAddress:recipient,minConfirmations:Number(process.env.YNX_CARD_MIN_CONFIRMATIONS??'2')});
  const providerRegistry=new CardProviderRegistry(store);
  const programs=parseIssuingPrograms(JSON.parse(process.env.YNX_CARD_TEST_PROGRAMS_JSON??'[]'));
  if(process.env.YNX_CARD_PROVIDER_TEST_WRITE_ENABLED!==undefined&&!['true','false'].includes(process.env.YNX_CARD_PROVIDER_TEST_WRITE_ENABLED))throw Error('Invalid YNX_CARD_PROVIDER_TEST_WRITE_ENABLED');
  const providerApplications=new CardProviderApplications(store,undefined,undefined,[],programs,providerRegistry);
  const immersve=ImmersveSandbox.fromEnvironment(store);
  const walletRegistry=JSON.parse(readFileSync(resolve(__dirname,'../vendor/product-session-registry-09e36b150.json'),'utf8'));
  const providerLifecycle=new CardProviderLifecycle(store,providerApplications,providerRegistry,immersve,walletRegistry,programs,process.env.YNX_CARD_PROVIDER_TEST_WRITE_ENABLED==='true');
  const financeRead=new CardFinanceRead(store,providerRegistry,providerLifecycle,process.env.YNX_CARD_FINANCE_READ_KEY||undefined);
  const server=createCardServer({service,wallet,providerRegistry,providerApplications,providerLifecycle,financeRead,sourceCommit:process.env.YNX_CARD_SOURCE_COMMIT??'unbound-development',allowedOrigin:process.env.YNX_CARD_ALLOWED_ORIGIN??'https://card.ynxweb4.com',configurationReady:Boolean(adapter&&rpc&&recipient)});
  const port=Number(process.env.YNX_CARD_PORT??'3094');if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Invalid YNX_CARD_PORT');
  server.listen(port,process.env.YNX_CARD_HOST??'127.0.0.1',()=>console.log(JSON.stringify({service:'ynx-card-business-backend',port,environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',productionRealPayments:false})));
  const stop=()=>server.close(()=>{store.close();process.exitCode=0});process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Card backend failed to start');process.exitCode=1});
