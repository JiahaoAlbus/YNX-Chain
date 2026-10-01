import {Platform} from 'react-native';
import {CARD_BUSINESS_ORIGIN,CardBusinessClient,type CardPrivateIdentity} from './cardBusinessClient';
import {CardProviderClient} from './providerApplicationClient';
import compatibility from '../card-source-compatibility.json';

type RuntimeIdentity={sourceCommit?:unknown;sourceTree?:unknown;productId?:unknown;service?:unknown;schemaVersion?:unknown;environment?:unknown;evmChainId?:unknown;evmChainHex?:unknown;paymentNetwork?:unknown;productionRealPayments?:unknown;cardApiCompatibility?:unknown};
const compiledFrontendCommit=process.env.EXPO_PUBLIC_CARD_SOURCE_COMMIT;
const compiledFrontendTree=process.env.EXPO_PUBLIC_CARD_SOURCE_TREE;
export function validateCardSourcePair(version:RuntimeIdentity,build?:RuntimeIdentity):string{
  if(version.service!==compatibility.backendService||version.schemaVersion!==compatibility.backendVersionSchema||version.sourceCommit!==compatibility.backendSourceCommit||version.environment!==compatibility.environment||version.productionRealPayments!==false)throw Error('CARD_API_SOURCE_UNAVAILABLE');
  if(build){
    const expectedCommit=compiledFrontendCommit??compatibility.frontendSourceBase;
    if(build.schemaVersion!=='ynx.card.runtime-identity.v1'||build.productId!=='ynx-card'||build.environment!=='testnet'||build.productionRealPayments!==false||build.paymentNetwork!=='simulation'||build.evmChainId!==6423||build.evmChainHex!=='0x1917'||build.sourceCommit!==expectedCommit||!/^[a-f0-9]{40}$/.test(String(build.sourceTree))||compiledFrontendTree&&build.sourceTree!==compiledFrontendTree)throw Error('CARD_API_SOURCE_MISMATCH');
    if(build.sourceCommit!==compatibility.frontendSourceBase){
      const pair=build.cardApiCompatibility as Record<string,unknown>|null;
      if(!pair||typeof pair!=='object'||Array.isArray(pair)||pair.schemaVersion!==compatibility.schemaVersion||pair.frontendSourceBase!==compatibility.frontendSourceBase||pair.frontendSourceCommit!==build.sourceCommit||pair.frontendSourceTree!==build.sourceTree||pair.backendSourceCommit!==version.sourceCommit||pair.backendVersionSchema!==compatibility.backendVersionSchema)throw Error('CARD_API_SOURCE_MISMATCH');
    }
  }
  return compatibility.backendSourceCommit;
}
async function json(url:string):Promise<RuntimeIdentity>{const response=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000)});if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))throw Error('CARD_API_SOURCE_UNAVAILABLE');return await response.json() as RuntimeIdentity}
export async function cardProviderSourceCommit():Promise<string>{
  const version=await json(CARD_BUSINESS_ORIGIN+'/api/card/v1/version');
  return validateCardSourcePair(version,Platform.OS==='web'?await json('/runtime-identity.json'):undefined);
}
export async function createRuntimeCardBusinessClient(capabilities:{identity:()=>CardPrivateIdentity|null;createIntrospectionProof:(scopes:readonly string[])=>Promise<{proofHeader:string}>}){
  return new CardBusinessClient({...capabilities,expectedSourceCommit:await cardProviderSourceCommit(),platform:Platform.OS==='ios'||Platform.OS==='android'?Platform.OS:'web'});
}
export async function createRuntimeProviderClient(capabilities:{identity:()=>CardPrivateIdentity|null;createIntrospectionProof:(scopes:readonly string[])=>Promise<{proofHeader:string}>}){
  return new CardProviderClient({...capabilities,expectedSourceCommit:await cardProviderSourceCommit(),platform:Platform.OS==='ios'||Platform.OS==='android'?Platform.OS:'web'});
}
