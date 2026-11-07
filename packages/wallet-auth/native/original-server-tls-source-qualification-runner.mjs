// Fixed serverTLS qualification math runner; no alternate getter/clock/module,
// role keys, principal, listener, certificate private bytes or provider input.
import{canonical}from'./original-auth-identity-source-verifier.mjs';
import{dispatchOriginalSourceV2}from'./original-auth-source-v2-dispatch.mjs';
import{SERVER_TLS_SOURCE_PURPOSE}from'./original-server-tls-source-contract.mjs';
try{if(process.argv.length!==2)throw 0;let length=0;const parts=[];for await(const b of process.stdin){length+=b.length;if(length>2097152)throw 0;parts.push(b);}const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(parts)),input=JSON.parse(raw);if(canonical(input)!==raw||input?.policy?.signatureContract?.purpose!==SERVER_TLS_SOURCE_PURPOSE)throw 0;const result=await dispatchOriginalSourceV2(input),out=Buffer.from(canonical(result));if(out.length>1048576)throw 0;await new Promise((resolve,reject)=>process.stdout.write(out,e=>e?reject(e):resolve()));}catch{process.exitCode=65;process.stderr.write('SERVER_TLS_SOURCE_QUALIFICATION_REJECTED\n');}
