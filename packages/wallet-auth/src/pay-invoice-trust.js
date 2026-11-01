import{exactFields,WalletAuthError}from'./canonical.js';
const fail=()=>{throw new WalletAuthError('PAY_INVOICE_SIGNER_UNTRUSTED','Invoice signing authority is not independently registered');};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
// Only create this policy from a protected operator configuration or a
// provenance-verified release input. Never pass invoice/QR/merchant response as
// config. This checks trust; original invoice signature verification is separate.
export function createPayInvoiceSignerPolicy(config){
 exactFields(config,['schemaVersion','signers'],'Pay invoice signer policy');if(config.schemaVersion!=='ynx-pay-invoice-signers/v1'||!Array.isArray(config.signers)||config.signers.length<1||config.signers.length>64)fail();
 const keys=new Map();for(const signer of config.signers){exactFields(signer,['keyId','publicKey','algorithm','merchantIds'],'Pay invoice signer');if(!id(signer.keyId)||keys.has(signer.keyId)||signer.algorithm!=='ed25519'||typeof signer.publicKey!=='string'||!/^[a-f0-9]{64}$/.test(signer.publicKey)||!Array.isArray(signer.merchantIds)||signer.merchantIds.length<1||signer.merchantIds.length>128||signer.merchantIds.some(v=>!id(v))||new Set(signer.merchantIds).size!==signer.merchantIds.length)fail();keys.set(signer.keyId,Object.freeze({keyId:signer.keyId,publicKey:signer.publicKey,algorithm:'ed25519',merchantIds:Object.freeze([...signer.merchantIds])}));}
 return Object.freeze({resolve(input){exactFields(input,['signatureKeyId','signingPublicKey','signatureAlgorithm','merchantId'],'Invoice signer binding');const signer=keys.get(input.signatureKeyId);if(!signer||input.signatureAlgorithm!==signer.algorithm||input.signingPublicKey!==signer.publicKey||!signer.merchantIds.includes(input.merchantId))fail();return Object.freeze({keyId:signer.keyId,publicKey:signer.publicKey,algorithm:signer.algorithm});}});
}
