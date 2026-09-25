import {Platform} from 'react-native';
import {CARD_BUSINESS_ORIGIN,type CardPrivateIdentity} from './cardBusinessClient';
import {CardProviderClient} from './providerApplicationClient';

type RuntimeIdentity={sourceCommit?:unknown;schemaVersion?:unknown;environment?:unknown;productionRealPayments?:unknown};
async function json(url:string):Promise<RuntimeIdentity>{const response=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000)});if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))throw Error('CARD_API_SOURCE_UNAVAILABLE');return await response.json() as RuntimeIdentity}
export async function cardProviderSourceCommit():Promise<string>{
  const version=await json(CARD_BUSINESS_ORIGIN+'/api/card/v1/version');
  if(!/^[a-f0-9]{40}$/.test(String(version.sourceCommit))||version.environment!=='YNX_TESTNET_CARD_PAYMENT_SIMULATION'||version.productionRealPayments!==false)throw Error('CARD_API_SOURCE_UNAVAILABLE');
  if(Platform.OS==='web'){
    const build=await json('/runtime-identity.json');
    if(build.schemaVersion!=='ynx.card.runtime-identity.v1'||build.environment!=='testnet'||build.productionRealPayments!==false||build.sourceCommit!==version.sourceCommit)throw Error('CARD_API_SOURCE_MISMATCH');
  }
  return String(version.sourceCommit);
}
export async function createRuntimeProviderClient(capabilities:{identity:()=>CardPrivateIdentity|null;createIntrospectionProof:(scopes:readonly string[])=>Promise<{proofHeader:string}>}){
  return new CardProviderClient({...capabilities,expectedSourceCommit:await cardProviderSourceCommit(),platform:Platform.OS==='ios'||Platform.OS==='android'?Platform.OS:'web'});
}
