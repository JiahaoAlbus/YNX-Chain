export type FinanceAuthorityV2NativeCapabilities={
  verifyEd25519?:(message:Uint8Array,signature:Uint8Array,publicKey:Uint8Array)=>Promise<boolean>;
  durableCompareAndSwap?:(previous:unknown,next:unknown)=>Promise<boolean>;
  trustedClockMs?:()=>number;
};

export function assertFinanceAuthorityV2NativeCapabilities(capabilities:FinanceAuthorityV2NativeCapabilities|undefined):never{
  const missing:string[]=[];
  if(typeof capabilities?.verifyEd25519!=='function')missing.push('Ed25519');
  if(typeof capabilities?.durableCompareAndSwap!=='function')missing.push('durable-CAS');
  if(typeof capabilities?.trustedClockMs!=='function')missing.push('trusted-clock');
  // The current native release deliberately has no reviewed implementation of
  // these capabilities. SecureStore is not atomic CAS and expo-crypto's digest
  // API is not Ed25519 verification. Never relabel v1 digest validation as v2.
  throw new Error(`PRIVATE_SERVICE_DEGRADED: FINANCE_AUTHORITY_V2_NATIVE_CAPABILITY_UNAVAILABLE:${missing.length?missing.join(','):'adapter-not-reviewed'}`);
}
