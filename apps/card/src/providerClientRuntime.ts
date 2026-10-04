import {Platform} from 'react-native';
import {CARD_BUSINESS_ORIGIN,CardBusinessClient,type CardPrivateIdentity} from './cardBusinessClient';
import {CardProviderClient} from './providerApplicationClient';
import compatibility from '../card-source-compatibility.json';

type RuntimeIdentity={sourceCommit?:unknown;sourceTree?:unknown;productId?:unknown;service?:unknown;schemaVersion?:unknown;environment?:unknown;evmChainId?:unknown;evmChainHex?:unknown;paymentNetwork?:unknown;productionRealPayments?:unknown;cardApiCompatibility?:unknown};
const compiledFrontendCommit=process.env.EXPO_PUBLIC_CARD_SOURCE_COMMIT;
const compiledFrontendTree=process.env.EXPO_PUBLIC_CARD_SOURCE_TREE;
type SourceFailureStage='backend-identity'|'frontend-identity'|'source-binding'|'version-transport';
export class CardSourceVerificationError extends Error{
  readonly code:'CARD_API_SOURCE_MISMATCH'|'CARD_API_SOURCE_UNAVAILABLE';
  readonly stage:SourceFailureStage;
  constructor(code:'CARD_API_SOURCE_MISMATCH'|'CARD_API_SOURCE_UNAVAILABLE',stage:SourceFailureStage){
    super(code);this.name='CardSourceVerificationError';this.code=code;this.stage=stage;
  }
}
function sourceMismatch(stage:SourceFailureStage):never{throw new CardSourceVerificationError('CARD_API_SOURCE_MISMATCH',stage)}
export function validateCardSourcePair(version:RuntimeIdentity,build?:RuntimeIdentity):string{
  if(!version||typeof version!=='object'||Array.isArray(version)||version.service!==compatibility.backendService||version.schemaVersion!==compatibility.backendVersionSchema||version.sourceCommit!==compatibility.backendSourceCommit||version.environment!==compatibility.environment||version.productionRealPayments!==false)sourceMismatch('backend-identity');
  if(build){
    const expectedCommit=compiledFrontendCommit??compatibility.frontendSourceBase;
    if(typeof build!=='object'||Array.isArray(build)||build.schemaVersion!=='ynx.card.runtime-identity.v1'||build.productId!=='ynx-card'||build.environment!=='testnet'||build.productionRealPayments!==false||build.paymentNetwork!=='simulation'||build.evmChainId!==6423||build.evmChainHex!=='0x1917'||build.sourceCommit!==expectedCommit||!/^[a-f0-9]{40}$/.test(String(build.sourceTree))||compiledFrontendTree&&build.sourceTree!==compiledFrontendTree)sourceMismatch('frontend-identity');
    if(build.sourceCommit!==compatibility.frontendSourceBase){
      const pair=build.cardApiCompatibility as Record<string,unknown>|null;
      if(!pair||typeof pair!=='object'||Array.isArray(pair)||pair.schemaVersion!==compatibility.schemaVersion||pair.frontendSourceBase!==compatibility.frontendSourceBase||pair.frontendSourceCommit!==build.sourceCommit||pair.frontendSourceTree!==build.sourceTree||pair.backendSourceCommit!==version.sourceCommit||pair.backendVersionSchema!==compatibility.backendVersionSchema)sourceMismatch('source-binding');
    }
  }
  return compatibility.backendSourceCommit;
}
async function json(url:string):Promise<RuntimeIdentity>{
  try{
    const response=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000)});
    if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('unavailable');
    const text=await response.text();
    if(text.length>16_384)throw Error('oversized');
    const value:unknown=JSON.parse(text);
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid');
    return value as RuntimeIdentity;
  }catch{throw new CardSourceVerificationError('CARD_API_SOURCE_UNAVAILABLE','version-transport')}
}
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
