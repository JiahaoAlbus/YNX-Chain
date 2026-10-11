import https from 'node:https';
import {lookup} from 'node:dns';
import {BlockList,isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {utils as tronUtils} from 'tronweb';
import {tronAddress} from './multichain-tron.mjs';

const fail=code=>Object.assign(new Error(code),{code});
const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(ip,bits,'ipv4');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');
const blocked6=new BlockList();for(const [ip,bits]of[['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked6.addSubnet(ip,bits,'ipv6');
function publicIP(ip){const f=isIP(ip);return f===4?!blocked.check(ip,'ipv4'):f===6&&global6.check(ip,'ipv6')&&!blocked6.check(ip,'ipv6');}
function exact(o,required,optional=[]){if(!o||typeof o!=='object'||Array.isArray(o)||required.some(k=>!Object.hasOwn(o,k))||Object.keys(o).some(k=>!required.includes(k)&&!optional.includes(k)))throw fail('TRON_BROADCAST_INPUT');}
function safe(value,positive=false){if(!Number.isSafeInteger(value)||value<(positive?1:0))throw fail('TRON_BROADCAST_BINDING');return value;}
function address(value){if(typeof value!=='string'||!/^41[0-9a-f]{40}$/.test(value))throw fail('TRON_BROADCAST_BINDING');return tronAddress(value).hex;}
function hex(value,bytes){if(typeof value!=='string'||value.length!==bytes*2||!/^[0-9a-f]+$/.test(value))throw fail('TRON_BROADCAST_BINDING');return value;}
function originalSigned(input,networkId){
  exact(input,['network','txid','transaction']);if(input.network!==networkId)throw fail('TRON_BROADCAST_NETWORK');hex(input.txid,32);
  // Snapshot locally before the first async boundary. Only these exact bytes are
  // sent. Local codec reconstruction below verifies binding, never replaces tx.
  let transaction;try{transaction=structuredClone(input.transaction);}catch{throw fail('TRON_BROADCAST_INPUT');}
  exact(transaction,['visible','txID','raw_data','raw_data_hex','signature']);
  if(transaction.visible!==false||transaction.txID!==input.txid||!Array.isArray(transaction.signature)||transaction.signature.length!==1)throw fail('TRON_BROADCAST_BINDING');
  // Official signer emits mixed-case signature hex; preserve the original
  // representation, accepting its 65 bytes without lowercase rewriting.
  if(typeof transaction.signature[0]!=='string'||!/^[0-9a-fA-F]{130}$/.test(transaction.signature[0]))throw fail('TRON_BROADCAST_BINDING');const raw=transaction.raw_data;
  exact(raw,['contract','ref_block_bytes','ref_block_hash','timestamp','expiration'],['fee_limit']);
  hex(raw.ref_block_bytes,2);hex(raw.ref_block_hash,8);safe(raw.timestamp,true);safe(raw.expiration,true);
  if(raw.expiration<=raw.timestamp||raw.expiration-raw.timestamp>86400000)throw fail('TRON_BROADCAST_BINDING');
  if(!Array.isArray(raw.contract)||raw.contract.length!==1)throw fail('TRON_BROADCAST_BINDING');
  const c=raw.contract[0];exact(c,['type','parameter'],['Permission_id']);if((c.Permission_id??0)!==0)throw fail('TRON_BROADCAST_PERMISSION');
  if(!['TransferContract','TriggerSmartContract'].includes(c.type))throw fail('TRON_BROADCAST_CONTRACT');
  exact(c.parameter,['value','type_url']);if(c.parameter.type_url!=='type.googleapis.com/protocol.'+c.type)throw fail('TRON_BROADCAST_BINDING');
  const v=c.parameter.value;let owner;
  if(c.type==='TransferContract'){
    exact(v,['owner_address','to_address','amount']);owner=address(v.owner_address);address(v.to_address);safe(v.amount,true);
    if(Object.hasOwn(raw,'fee_limit'))throw fail('TRON_BROADCAST_BINDING');
  }else{
    exact(v,['owner_address','contract_address','call_value','data']);owner=address(v.owner_address);address(v.contract_address);
    if(v.call_value!==0||typeof v.data!=='string'||!/^a9059cbb0{24}[0-9a-f]{40}[0-9a-f]{64}$/.test(v.data))throw fail('TRON_BROADCAST_CONTRACT');
    address('41'+v.data.slice(32,72));if(BigInt('0x'+v.data.slice(72))===0n)throw fail('TRON_BROADCAST_BINDING');safe(raw.fee_limit,true);
  }
  if(typeof transaction.raw_data_hex!=='string'||transaction.raw_data_hex.length>20000||!/^(?:[0-9a-f]{2})+$/.test(transaction.raw_data_hex))throw fail('TRON_BROADCAST_BINDING');
  let encoded,recovered;try{
    encoded=tronUtils.transaction.txPbToRawDataHex(tronUtils.transaction.txJsonToPb({visible:false,raw_data:raw})).toLowerCase();
    recovered=tronAddress(tronUtils.crypto.ecRecover(input.txid,transaction.signature[0])).hex;
  }catch{throw fail('TRON_BROADCAST_SIGNATURE');}
  if(encoded!==transaction.raw_data_hex||createHash('sha256').update(Buffer.from(encoded,'hex')).digest('hex')!==input.txid||recovered!==owner)throw fail('TRON_BROADCAST_BINDING');
  return JSON.stringify(transaction);
}
/** Not an authority source, chain identity verifier, or durable replay fence.
 * Parent must enforce original signed result, pinned genesis, unexpired review,
 * explicit fresh human approval and journal broadcast grant before this call.
 * No signing, payload rebuilding, redirects, auth, proxy, or retries. */
export function createTronBroadcastTransport(options){
  exact(options,['networkId','baseURL'],['request','dnsLookup','timeout','maxBytes']);
  const {networkId,baseURL,request=https.request,dnsLookup=lookup,timeout=12000,maxBytes=4096}=options;
  if(!['mainnet','nile','shasta'].includes(networkId)||typeof baseURL!=='string'||typeof request!=='function'||typeof dnsLookup!=='function'||!Number.isSafeInteger(timeout)||timeout<1||timeout>60000||!Number.isSafeInteger(maxBytes)||maxBytes<64||maxBytes>65536)throw fail('TRON_BROADCAST_CONFIG');
  if(/[\\%?#\s]/.test(baseURL)||/\/(?:\.|\.\.)(?:\/|$)/.test(baseURL))throw fail('TRON_BROADCAST_URL');let base;try{base=new URL(baseURL);}catch{throw fail('TRON_BROADCAST_URL');}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||(base.port&&base.port!=='443')||isIP(base.hostname.replace(/^\[|\]$/g,''))||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(base.hostname)||!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(base.pathname))throw fail('TRON_BROADCAST_URL');
  const target=new URL(base.href);target.pathname=base.pathname.replace(/\/$/,'')+'/wallet/broadcasttransaction';
  let attempted=false;
  return async(input,extra={})=>{
    if(attempted)throw fail('TRON_BROADCAST_ALREADY_ATTEMPTED');attempted=true; // includes validation, DNS, abort and ambiguous ACK
    exact(extra,[],['signal']);const {signal}=extra;
    if(signal!==undefined&&!(signal instanceof AbortSignal))throw fail('TRON_BROADCAST_INPUT');
    const body=originalSigned(input,networkId),txid=input.txid;
    const observation=state=>Object.freeze({networkId,txid,state,receipt:null});
    if(signal?.aborted)return observation('unknown');
    return new Promise(resolve=>{
      let req,settled=false,bodySent=false,dnsCompleted=false;
      const finish=state=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(observation(state));};
      const stop=()=>{if(settled)return;finish('unknown');req?.destroy();};const abort=()=>stop();
      const timer=setTimeout(stop,timeout);signal?.addEventListener('abort',abort,{once:true});
      try{dnsLookup(base.hostname,{all:true,verbatim:true},(error,addresses)=>{
        if(settled||dnsCompleted)return;dnsCompleted=true;
        if(error||!Array.isArray(addresses)||!addresses.length||addresses.length>64||addresses.some(r=>!publicIP(r?.address)||r.family!==isIP(r.address)))return stop();
        const pin={address:addresses[0].address,family:addresses[0].family},same=new BlockList();same.addAddress(pin.address,pin.family===4?'ipv4':'ipv6');
        const pinnedLookup=(hostname,opts,cb)=>{if(hostname!==base.hostname||(opts?.family&&opts.family!==pin.family))return cb(fail('TRON_BROADCAST_DNS'));opts?.all?cb(null,[pin]):cb(null,pin.address,pin.family);};
        try{
          req=request(target,{method:'POST',lookup:pinnedLookup,agent:false,autoSelectFamily:false,useEnvProxy:false,rejectUnauthorized:true,servername:base.hostname,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),accept:'application/json','accept-encoding':'identity'}},response=>{
            if(settled){response.destroy();return;}
            if(!bodySent||response.statusCode!==200||String(response.headers?.['content-type']??'').split(';')[0].trim().toLowerCase()!=='application/json'||(response.headers?.['content-encoding']&&response.headers['content-encoding']!=='identity')){response.destroy();return stop();}
            let bytes=0;const chunks=[];
            response.on('data',chunk=>{if(settled)return;const b=Buffer.from(chunk);bytes+=b.length;if(bytes>maxBytes){response.destroy();stop();}else chunks.push(b);});
            response.on('error',stop);response.on('aborted',stop);
            response.on('end',()=>{
              let ack,text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));ack=JSON.parse(text);}catch{return finish('unknown');}
              // Narrow primitive-only schema. Duplicate JSON keys and escaped
              // aliases are anomalous ACK, not silently last-key-wins success.
              const accepted=ack&&typeof ack==='object'&&!Array.isArray(ack)&&ack.result===true&&ack.txid===txid&&
                Object.keys(ack).every(k=>['result','txid','code'].includes(k))&&(ack.code===undefined||ack.code===0||ack.code==='SUCCESS')&&
                !text.includes('\\')&&(text.match(/"[^"\\]*"\s*:/g)||[]).length===Object.keys(ack).length;
              finish(accepted?'submitted-unconfirmed':'unknown');
            });
            response.on('close',()=>{if(!settled)stop();});
          });
          req.on('error',stop);req.on('socket',socket=>{socket.once('secureConnect',()=>{
            if(settled)return;const family=isIP(socket.remoteAddress);
            if(!socket.encrypted||socket.authorized!==true||family!==pin.family||!publicIP(socket.remoteAddress)||!same.check(socket.remoteAddress,family===4?'ipv4':'ipv6'))return stop();
            if(bodySent)return stop();bodySent=true;req.end(body);
          });});
          if(signal?.aborted)stop();
        }catch{stop();}
      });}catch{stop();}
    });
  };
}
