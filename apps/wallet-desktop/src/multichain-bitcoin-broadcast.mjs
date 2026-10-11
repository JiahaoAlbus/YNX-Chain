import https from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Transaction } from 'bitcoinjs-lib';

const fail = code => Object.assign(new Error(code), { code });
const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(ip,bits,'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::',3,'ipv6');
const blocked6 = new BlockList();
for (const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) blocked6.addSubnet(ip,bits,'ipv6');
function publicIP(ip) {
  const family = isIP(ip);
  return family === 4 ? !blocked.check(ip,'ipv4') : family === 6 && global6.check(ip,'ipv6') && !blocked6.check(ip,'ipv6');
}
function exact(o, keys) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length !== keys.length || keys.some(k=>!Object.hasOwn(o,k))) throw fail('BTC_BROADCAST_INPUT');
}
/** Original signed bytes only. Not an authority source or durable replay fence.
 * Parent must verify produced result, endpoint genesis and explicit journal grant
 * before calling. No private material, signing, redirects, proxy or retries. */
export function createBitcoinBroadcastTransport(options) {
  if (!options || Object.keys(options).some(k=>!['networkId','baseURL','request','dnsLookup','timeout','maxBytes'].includes(k))) throw fail('BTC_BROADCAST_CONFIG');
  const {networkId,baseURL,request=https.request,dnsLookup=lookup,timeout=12000,maxBytes=4096}=options;
  if (typeof networkId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(networkId) || typeof baseURL !== 'string' || typeof request !== 'function' || typeof dnsLookup !== 'function' || !Number.isSafeInteger(timeout) || timeout<1 || timeout>60000 || !Number.isSafeInteger(maxBytes) || maxBytes<64 || maxBytes>65536) throw fail('BTC_BROADCAST_CONFIG');
  if (/[\\%?#\s]/.test(baseURL)) throw fail('BTC_BROADCAST_URL');
  let base; try { base=new URL(baseURL); } catch { throw fail('BTC_BROADCAST_URL'); }
  if (base.protocol!=='https:' || base.username || base.password || base.search || base.hash || base.port && base.port!=='443' || isIP(base.hostname.replace(/^\[|\]$/g,'')) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(base.hostname) || !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(base.pathname)) throw fail('BTC_BROADCAST_URL');
  const target=new URL(base.href); target.pathname=base.pathname.replace(/\/$/,'')+'/tx';
  let attempted=false;
  return async (input, extra={}) => {
    exact(input,['network','txid','rawTransaction']);
    if (!extra || Object.keys(extra).some(k=>k!=='signal')) throw fail('BTC_BROADCAST_INPUT');
    const {network,txid,rawTransaction}=input, {signal}=extra;
    if (network!==networkId || typeof txid!=='string' || !/^[0-9a-f]{64}$/.test(txid) || typeof rawTransaction!=='string' || !/^(?:[0-9a-f]{2})+$/.test(rawTransaction) || rawTransaction.length>2000000) throw fail('BTC_BROADCAST_BINDING');
    let tx; try { tx=Transaction.fromHex(rawTransaction); } catch { throw fail('BTC_BROADCAST_RAW'); }
    if (tx.toHex()!==rawTransaction || tx.getId()!==txid || !tx.hasWitnesses() || !tx.ins.length || !tx.outs.length) throw fail('BTC_BROADCAST_BINDING');
    if (attempted) throw fail('BTC_BROADCAST_ALREADY_ATTEMPTED');
    attempted=true; // Includes DNS/TLS/timeout uncertainty; never replay this instance.
    const observation = state => Object.freeze({networkId,txid,state,receipt:null});
    if (signal?.aborted) return observation('unknown');
    return new Promise(resolve=>{
      let req, settled=false, bodySent=false, dnsCompleted=false;
      const finish=state=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(observation(state));};
      const stop=()=>{if(settled)return;finish('unknown');req?.destroy();};
      const abort=()=>stop();
      const timer=setTimeout(stop,timeout);
      signal?.addEventListener('abort',abort,{once:true});
      try { dnsLookup(base.hostname,{all:true,verbatim:true},(error,addresses)=>{
        if(settled || dnsCompleted)return; dnsCompleted=true;
        if(error || !Array.isArray(addresses) || !addresses.length || addresses.length>64 || addresses.some(r=>!publicIP(r?.address) || r.family!==isIP(r.address))) return stop();
        const pin=addresses[0], same=new BlockList(); same.addAddress(pin.address,pin.family===4?'ipv4':'ipv6');
        const pinnedLookup=(hostname,opts,cb)=>{
          if(hostname!==base.hostname || opts?.family && opts.family!==pin.family) return cb(fail('BTC_BROADCAST_DNS'));
          opts?.all ? cb(null,[pin]) : cb(null,pin.address,pin.family);
        };
        try {
          req=request(target,{method:'POST',lookup:pinnedLookup,agent:false,autoSelectFamily:false,useEnvProxy:false,rejectUnauthorized:true,servername:base.hostname,headers:{'content-type':'text/plain','content-length':Buffer.byteLength(rawTransaction),'accept':'text/plain','accept-encoding':'identity'}},response=>{
            if(settled){response.destroy();return;}
            if(!bodySent || response.statusCode!==200 || String(response.headers?.['content-type']??'').split(';')[0].trim().toLowerCase()!=='text/plain' || response.headers?.['content-encoding'] && response.headers['content-encoding']!=='identity') {response.destroy();return stop();}
            let bytes=0;const chunks=[];
            response.on('data',chunk=>{if(settled)return;const b=Buffer.from(chunk);bytes+=b.length;if(bytes>maxBytes){response.destroy();stop();}else chunks.push(b);});
            response.on('error',stop);response.on('aborted',stop);
            response.on('end',()=>finish(Buffer.concat(chunks).toString('utf8')===txid?'submitted-unconfirmed':'unknown'));
            response.on('close',()=>{if(!settled)stop();});
          });
          req.on('error',stop);
          req.on('socket',socket=>{
            socket.once('secureConnect',()=>{
              if(settled)return;
              const family=isIP(socket.remoteAddress);
              if(!socket.encrypted || socket.authorized!==true || family!==pin.family || !publicIP(socket.remoteAddress) || !same.check(socket.remoteAddress,family===4?'ipv4':'ipv6')) return stop();
              if(bodySent)return stop(); bodySent=true;req.end(rawTransaction);
            });
          });
          if(signal?.aborted)stop();
        } catch {stop();}
      }); } catch {stop();}
    });
  };
}
