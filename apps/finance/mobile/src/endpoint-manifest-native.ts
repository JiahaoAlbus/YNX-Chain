import * as Crypto from 'expo-crypto';
import {assertFinanceConsumerContract,assertFinanceProductSessionContract,financeNetworkEndpoints} from './endpoint-manifest';

const nativeDigest=(payload:string)=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,payload,{encoding:Crypto.CryptoEncoding.HEX});
export const assertFinanceConsumerContractNative=(nowMs=Date.now())=>assertFinanceConsumerContract(nowMs,nativeDigest);
export const financeNetworkEndpointsNative=(nowMs=Date.now())=>financeNetworkEndpoints(nowMs,nativeDigest);
export const assertFinanceProductSessionContractNative=(nowMs=Date.now())=>assertFinanceProductSessionContract(nowMs,nativeDigest);
