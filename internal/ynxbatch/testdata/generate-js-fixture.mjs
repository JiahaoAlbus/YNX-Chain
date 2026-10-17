// Run manually with the pinned standalone JS candidate path as argv[2].
// Fresh research-only keys; writes public messages, keys and signatures only.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]);
const y=await import(pathToFileURL(resolve(root,'src/index.mjs')));
const t=await import(pathToFileURL(resolve(root,'src/tree.mjs')));
const {ml_dsa87}=await import(pathToFileURL(resolve(root,'node_modules/@noble/post-quantum/ml-dsa.js')));
const {slh_dsa_sha2_256f}=await import(pathToFileURL(resolve(root,'node_modules/@noble/post-quantum/slh-dsa.js')));
const key=y.keyGen();
const metadata={chainId:Buffer.alloc(32,0x71),owner:'ynx-go-interop-research-only',purpose:'TX-BATCH'};
const messages=Array.from({length:8},(_,i)=>Buffer.concat([Buffer.from([0,255,i]),Buffer.from('complete-message-'+i)]));
const batch=y.batchSign(key.privateKey,metadata,messages);
const c=y.decodeCertificate(batch.certificateWire),context=y.encodeContext(c),descriptor=y.encodeDescriptor(c);
const h=t.createHasher(context,c.N),a=t.buildTree(h.A,messages),b=t.buildTree(h.B,messages);
const originals=t.createHasher(context,c.N,false);
for(const [branch,algorithm,tree] of [['A',ml_dsa87,a],['B',slh_dsa_sha2_256f,b]]) {
  if(!algorithm.verify(c['sigma'+branch],y.encodeFields([y.VERSION+'/CERT/'+branch,descriptor]),c['pk'+branch],{context:new Uint8Array()}))throw Error('independent verifier rejected fixture');
  const plain=t.buildTree(originals[branch],messages);
  if(!tree.every((level,i)=>level.every((node,j)=>node.equals(plain[i][j]))))throw Error('prefix differential');
}
const hex=x=>x.toString('hex'),base64=x=>x.toString('base64');
const output={note:'Research-only public interoperability fixture. No private keys, account authority, execution permit, or production network.',
  node:process.versions.node,openssl:process.versions.openssl,
  sources:Object.fromEntries(['codec','tree','index','native'].map(n=>[n,createHash('sha256').update(readFileSync(resolve(root,'src/'+n+'.mjs'))).digest('hex')])),
  chainID:hex(c.chainId),owner:c.owner,purpose:c.purpose,
  context:base64(context),descriptor:base64(descriptor),certificate:base64(batch.certificateWire),whole:base64(batch.wholeWire),
  member:base64(y.encodeMember(y.extract(batch.batch,7))),
  messages:messages.map(base64),treeA:a.map(level=>level.map(hex)),treeB:b.map(level=>level.map(hex)),
  proofs:messages.map((_,i)=>base64(y.encodeProof(y.extract(batch.batch,i),c.N)))};
writeFileSync(new URL('./js-interop.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
y.destroyKey(key.privateKey);y.discardBatch(batch.batch);
const nist=JSON.parse(readFileSync(resolve(root,'test/vectors/nist-acvp.json')));
// NIST vectors include published test seeds, never user key material.
writeFileSync(new URL('./nist-acvp.json',import.meta.url),JSON.stringify(nist)+'\n');
console.log(JSON.stringify({fixture:'js-interop.json',N:c.N,certificateBytes:batch.certificateWire.length,wholeBytes:batch.wholeWire.length,independentNobleAND:true,allTreeNodesDifferential:true,nistSourceRevision:nist.sourceRevision}));
