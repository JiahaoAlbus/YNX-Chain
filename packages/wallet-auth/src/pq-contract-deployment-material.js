// Fixed original Protocol registry and fourth IDE material handoff DATA only.
// No compiler, account, nonce, network I/O, signing or approval is performed.
// Exact originals remain required by original Go/Native before any execution.
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {capturePQContractDeploymentMaterialData} from './pq-contract-deployment-transport.js';
const pins=Object.freeze({
 SampleEVMWriteCounter:Object.freeze({sourceFile:'fea1e9e1cd9f75088c97fc7c12d794cf6ac3ff124c0130e094d97dbf0d782f8f',artifactFile:'200969375c0041a574f47adb202ee9d175f0d3ef5939ed76d918229420ba357f',buildInfoFile:'5613cb98c7973e6292bb274707901dd7ad00ff3d9fd477c04e4eead6cdb4af50',sourceHash:'961d42cf02384dad28e18137d58f2b46c93dbd3a80ca078a3d96726d6d86191b',deployedBytecodeHash:'bad6eaa7c1f17ed1e3073830127815b90b03ce1e0d15e113411f9ecdbb7d47a0',creationBytecodeHash:'2be6502d8d00d4ee3741b63489b091e99118dec3b211641f1e95dd15d91512ed'}),
 SampleYNXTCompatibleERC20:Object.freeze({sourceFile:'d14208fc8056140c05393f1142604ccb78d888d506fd44d8e62a06884b12a525',artifactFile:'b4a71c19bb810ee15fc7759be6d8c40668e705bcedf41bef68d518b1f5d07f7b',buildInfoFile:'0a6feea7841f4106c5e69a6beebd80c47ca140ff1c22595bea836ebe2e44903f',sourceHash:'344b1d80d8b2fec3d22a38aa98b28e2c6ab20429f26b6cef726da1e634cbb5c4',deployedBytecodeHash:'b8604e8a14d38cff0b32d2bca4e768e7a7ea95eac231673e4ec9838c58aa7118',creationBytecodeHash:'febbf4a7554d7fcddaf1c434e11e5c44f5c5e34ef79f4a972c3d58e2a0c12893'})
});
const te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const compilerHash='500f922ce0b89e7618d36ffbcd3238458891baee59b17040527042ce47db0c93';
const bad=()=>{throw Object.assign(new Error('PQ_CONTRACT_DEPLOYMENT_MATERIAL_INVALID'),{code:'PQ_CONTRACT_DEPLOYMENT_MATERIAL_INVALID'});};
function record(value,fields){
 if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))bad();const ds=Object.getOwnPropertyDescriptors(value),ks=Reflect.ownKeys(ds);
 if(ks.length!==fields.length||ks.some(k=>!fields.includes(k)))bad();const out=Object.create(null);for(const k of fields){const d=ds[k];if(!d||!Object.hasOwn(d,'value')||!d.enumerable)bad();out[k]=d.value;}return out;
}
function constructor(value){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)bad();const ds=Object.getOwnPropertyDescriptors(value),ks=Reflect.ownKeys(ds);
 if(ks.length!==2||!Object.hasOwn(ds,'0')||!Object.hasOwn(ds,'length')||ds.length.value!==1||!Object.hasOwn(ds['0'],'value')||!ds['0'].enumerable)bad();
 const n=ds['0'].value;if(typeof n!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(n)||BigInt(n)>18446744073709551615n)bad();return Object.freeze([n]);
}
const hash=raw=>bytesToHex(sha256(raw));
// Original Go hashParts includes a NUL AFTER EVERY UTF-8 field, including last.
function hashParts(...parts){const h=sha256.create();for(const p of parts){h.update(te.encode(p));h.update(new Uint8Array([0]));}return bytesToHex(h.digest());}
const goWhitespace='\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const trim=new RegExp('^['+goWhitespace+']+|['+goWhitespace+']+$','gu');
function normalizeHex(value){if(typeof value!=='string')bad();let hex=value.replace(trim,'').toLowerCase();if(!hex.startsWith('0x'))hex='0x'+hex;if(!/^0x[0-9a-f]+$/.test(hex)||hex.length>12288)bad();return hex;}
/** Exact bounded two-contract material selection. Constants fee/value are DATA,
 * not user approval. constructorArgs must contain one explicit canonical U64. */
export function preparePQContractDeploymentMaterialData(input){
 try{
  const fixed=record(input,['name','source','material','constructorArgs']);if(typeof fixed.name!=='string'||!Object.hasOwn(pins,fixed.name))bad();
  const selected=pins[fixed.name],args=constructor(fixed.constructorArgs);
  // Existing original portable capture rejects nontrim/oversize source and
  // unsafe buffers, copying both original files before parse/hash or exposure.
  const captured=capturePQContractDeploymentMaterialData({source:fixed.source,material:fixed.material}),source=captured.source,material=captured.material;
  if(hash(te.encode(source))!==selected.sourceFile||hash(material.artifactFile)!==selected.artifactFile||hash(material.buildInfoFile)!==selected.buildInfoFile)bad();
  const artifact=JSON.parse(td.decode(material.artifactFile)),build=JSON.parse(td.decode(material.buildInfoFile));
  if(artifact.contractName!==fixed.name||build.solcVersion!=='0.8.24')bad();
  const sourceHash=hashParts('source',source),deployedBytecodeHash=hashParts('solc-deployed-bytecode',normalizeHex(artifact.deployedBytecode));
  const config=hashParts('solidity-compiler','0.8.24','hardhat/solc-wasm','hardhat.config.ts','preferWasm=true','optimizer=true','runs=200');
  if(sourceHash!==selected.sourceHash||deployedBytecodeHash!==selected.deployedBytecodeHash||config!==compilerHash||hashParts('solc-bytecode',normalizeHex(artifact.bytecode))!==selected.creationBytecodeHash)bad();
  return Object.freeze({name:fixed.name,sourceHash,deployedBytecodeHash,compilerConfigHash:config,constructorArgs:args,value:'0',fee:'10',source,get material(){return Object.freeze({artifactFile:new Uint8Array(material.artifactFile),buildInfoFile:new Uint8Array(material.buildInfoFile)});},compilerMaterialValidationRequired:true,dataOnly:true,authorized:false,nativeAdmission:false});
 }catch{bad();}
}
