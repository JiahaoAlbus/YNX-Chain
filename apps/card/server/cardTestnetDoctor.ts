/** Configuration and optional public chain readback only. Never opens CardStore,
 * imports a credential adapter, requests an account or changes a funding intent. */
export const CARD_TESTNET_RPC='https://evm.ynxweb4.com';
type Environment=Record<string,string|undefined>;
export function cardTestnetDoctor(env:Environment=process.env){
  let rpcSyntaxValid=false,rpcCanonical=false;
  try{const url=new URL(env.YNX_CARD_CORE_RPC_URL??'');rpcSyntaxValid=url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;rpcCanonical=rpcSyntaxValid&&url.href===CARD_TESTNET_RPC+'/'}catch{}
  const encoded=env.YNX_CARD_STATE_KEY_BASE64??'',key=Buffer.from(encoded,'base64');
  const stateKeyConfigured=key.length===32&&key.toString('base64')===encoded;key.fill(0);
  const recipient=env.YNX_CARD_TESTNET_FUNDING_ADDRESS??'';
  const fundingRecipientConfigured=/^0x[0-9a-fA-F]{40}$/.test(recipient)&&!/^0x0{40}$/i.test(recipient);
  const minimum=Number(env.YNX_CARD_MIN_CONFIRMATIONS??'2');
  const sourceCommitBound=/^[0-9a-f]{40}$/.test(env.YNX_CARD_SOURCE_COMMIT??'');
  const allowedOrigin=env.YNX_CARD_ALLOWED_ORIGIN??'https://card.ynxweb4.com';
  const allowedOriginCanonical=allowedOrigin==='https://card.ynxweb4.com';
  const authAdapterConfigured=Boolean(env.YNX_CARD_AUTH_ADAPTER_MODULE);
  const minConfirmationsValid=Number.isSafeInteger(minimum)&&minimum>=1;
  const configurationComplete=rpcCanonical&&fundingRecipientConfigured&&stateKeyConfigured&&sourceCommitBound&&allowedOriginCanonical&&authAdapterConfigured&&minConfirmationsValid;
  return {
    schema:'ynx.card.testnet-preflight.v1',environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',chainId:'0x1917',asset:'YNXT_TESTNET',
    configuration:{rpcSyntaxValid,rpcCanonical,fundingRecipientConfigured,stateKeyConfigured,sourceCommitBound,allowedOriginCanonical,authAdapterConfigured,minConfirmationsValid,configurationComplete},
    authority:{adapterLoaded:'NOT_CHECKED',currentRoleActorBinding:'NOT_CHECKED',privateApiAccepted:false},
    chainReadback:{status:'NOT_RUN' as string,chainId:null as string|null},
    gates:{configurationOnly:true,runtimeReady:false,cardActive:false,walletApproved:false,walletSigned:false,transactionSent:false,fundingReceiptVerified:false,cardCredited:false,dataFabricDelivered:false,productionRealPayments:false},
    commercialProviderRequiredForNativeTestnetFunding:false,
  };
}
export async function readTestnetChain(report:ReturnType<typeof cardTestnetDoctor>,request:typeof fetch=fetch){
  if(!report.configuration.rpcCanonical)return {...report,chainReadback:{status:'CONFIGURATION_UNAVAILABLE',chainId:null}};
  try{
    const response=await request(CARD_TESTNET_RPC,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('HTTP_FAILURE');
    const body=await response.json() as {jsonrpc?:unknown;id?:unknown;error?:unknown;result?:unknown};
    if(body.jsonrpc!=='2.0'||body.id!==1||body.error!==undefined||body.result!=='0x1917')return {...report,chainReadback:{status:'WRONG_OR_UNVERIFIED_CHAIN',chainId:null}};
    return {...report,chainReadback:{status:'READBACK_MATCH',chainId:'0x1917'}};
  }catch{return {...report,chainReadback:{status:'RPC_UNAVAILABLE',chainId:null}}}
}
if(process.argv[1]?.endsWith('cardTestnetDoctor.ts')){
  const unknown=process.argv.slice(2).some(arg=>arg!=='--read-chain');
  if(unknown){process.stderr.write('Use card:testnet:doctor [--read-chain]\n');process.exitCode=1}
  else{
    const report=cardTestnetDoctor();
    Promise.resolve(process.argv.includes('--read-chain')?readTestnetChain(report):report).then(result=>process.stdout.write(JSON.stringify(result)+'\n'));
  }
}
