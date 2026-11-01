// Dedicated DATA schema for the original protected PQ catalog Source owner.
// It issues no registration/Root/Host/signing capability. Caller must already
// authenticate the independent Root/profile/current and real native process.
export const PQ_HOST_CATALOG_SOURCE_PURPOSE='wallet-pq-host-catalog-source-v1';
export const PQ_HOST_CATALOG_SOURCE_OPERATIONS=Object.freeze(['catalog.receive','catalog.current','catalog.retire']);
const fail=()=>{throw Object.assign(Error('AUTH_SOURCE_V2_PQ_CATALOG_SCOPE'),{code:'AUTH_SOURCE_V2_PQ_CATALOG_SCOPE'});};
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail();};
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v)&&!/^0+$/.test(v);
const text=v=>typeof v==='string'&&v.isWellFormed()&&Buffer.byteLength(v)>0&&Buffer.byteLength(v)<=256&&!/[\x00-\x20\x7f]/u.test(v);
const absolute=v=>typeof v==='string'&&v.isWellFormed()&&Buffer.byteLength(v)<=4096&&v.startsWith('/')&&v!=='/'&&!v.endsWith('/')&&!v.includes('//')&&!/[\x00-\x1f\x7f\\]/u.test(v)&&!v.split('/').some(x=>x==='.'||x==='..');
export function inspectOriginalPQHostCatalogSourceScopeDATA(scope,association,networkId,profileExpires,at){
 exact(scope,['version','journalBinding','deliveryManifestPath','deliveryManifestSHA256','bindingPath','bindingSHA256','outputPath','attemptPath','resultPath','protocolImagePath','protocolImageSHA256','protocolSourceRevision','protocolWalletRequestContract','protocolReconcileContract','walletCodeIdentity','issuedAtMs','expiresAtMs']);
 exact(scope.journalBinding,['operationId','account','networkId','originalHash','nativeWireHash','transactionHash']);
 const b=scope.journalBinding;
 if(scope.version!=='YNX-PQ-HOST-CATALOG-SOURCE/v1'||!text(b.operationId)||!text(b.account)||b.account!==association.account||b.networkId!==networkId||!hex(networkId,64)||!['nativeWireHash','transactionHash'].every(k=>hex(b[k],64))||b.originalHash!=='0x'+b.nativeWireHash)fail();
 for(const k of ['deliveryManifestPath','bindingPath','outputPath','attemptPath','resultPath','protocolImagePath'])if(!absolute(scope[k]))fail();
 if(new Set(['deliveryManifestPath','bindingPath','outputPath','attemptPath','resultPath','protocolImagePath'].map(k=>scope[k])).size!==6||scope.attemptPath!==scope.outputPath+'.source-attempt'||scope.resultPath!==scope.outputPath+'.source-result')fail();
 if(!['deliveryManifestSHA256','bindingSHA256','protocolImageSHA256'].every(k=>hex(scope[k],64))||!hex(scope.protocolSourceRevision,40)||scope.protocolWalletRequestContract!=='YNX-PQ-HOST-CATALOG-WALLET-JOURNAL6/v1')fail();
 if(scope.protocolReconcileContract!==''&&scope.protocolReconcileContract!=='YNX-PQ-HOST-CATALOG-WALLET-RECONCILE-JOURNAL6/v1')fail();
 if(typeof scope.walletCodeIdentity!=='string')fail();const code=Buffer.from(scope.walletCodeIdentity,'base64');if(code.length<20||code.length>64||code.toString('base64')!==scope.walletCodeIdentity)fail();
 if(![scope.issuedAtMs,scope.expiresAtMs,profileExpires,at].every(Number.isSafeInteger)||scope.issuedAtMs<0||scope.expiresAtMs<=scope.issuedAtMs||at<scope.issuedAtMs||at>=scope.expiresAtMs||scope.expiresAtMs>profileExpires)fail();
 return Object.freeze({version:scope.version,dataOnly:true,authorized:false,nativeAdmission:false});
}
