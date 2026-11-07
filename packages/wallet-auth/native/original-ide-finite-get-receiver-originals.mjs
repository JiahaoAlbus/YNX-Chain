// PRIVATE bounded normal verifier child. SOLE SDK parses original public V4;
// this adapter invents neither a public codec nor target/DEVICE authority.
import{canonicalJSON}from'../src/canonical.js';
import{decodeProductSessionProofHeaderV4,encodeProductSessionProofHeaderV4}from'../src/product-session-proof-v4.js';
import{decodeBase64url}from'../src/base64url.js';
let total=0;const chunks=[];
try{
 for await(const c of process.stdin){total+=c.length;if(total>262144)throw Error('budget');chunks.push(c)}
 const raw=Buffer.concat(chunks),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),x=JSON.parse(text);
 if(!x||Object.getPrototypeOf(x)!==Object.prototype||Object.keys(x).sort().join(',')!=='header,operation'||x.operation!=='ide-finite-get-v4-originals-data/v1'||canonicalJSON(x)!==text)throw Error('input');
 const decoded=decodeProductSessionProofHeaderV4(x.header),{member,...unsigned}=decoded,memberOriginal=decodeBase64url(member);
 if(unsigned.method!=='GET'||encodeProductSessionProofHeaderV4(unsigned,memberOriginal)!==x.header)throw Error('canonical');
 const original=Buffer.from(canonicalJSON(unsigned),'utf8');if(original.length>16384||memberOriginal.length>98304)throw Error('budget');
 const out=canonicalJSON({version:'IDE-FINITE-GET-V4-ORIGINALS-DATA/v1',unsignedOriginal:original.toString('base64url'),memberOriginal:Buffer.from(memberOriginal).toString('base64url'),dataOnly:true,authorized:false})+'\n';
 if(Buffer.byteLength(out)>262144)throw Error('output');process.stdout.write(out);
}catch{process.stderr.write('IDE_FINITE_GET_ORIGINALS_DATA_INVALID\n');process.exitCode=1}
