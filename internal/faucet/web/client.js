// Persist the exact intent before I/O; network errors never allocate a new request.
export class FaucetClient {
 constructor({fetch,storage,crypto}){this.fetch=fetch;this.storage=storage;this.crypto=crypto;this.key='ynx.faucet.request.v1';this.pending=null;this.config=null;this.inflight=false;}
 error(code){return Object.assign(new Error(code),{code})}
 restore(){try{const raw=this.storage.getItem(this.key);if(!raw){this.pending=null;return}const p=JSON.parse(raw);if(p.version!==1||p.chainId!==6423||typeof p.address!=='string'||!Number.isSafeInteger(p.amount)||p.amount<=0||!/^[A-Za-z0-9_-]{32,128}$/.test(p.requestId)||typeof p.durable!=='boolean'||!['prepared','sent','accepted'].includes(p.state))throw Error();this.pending=p;}catch{throw this.error('storage')}}
 save(p){try{const raw=JSON.stringify(p);this.storage.setItem(this.key,raw);if(this.storage.getItem(this.key)!==raw)throw Error();this.pending=p}catch{throw this.error('storage')}}
 async json(path,options={}){const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);try{const r=await this.fetch(path,{...options,cache:'no-store',credentials:'omit',signal:abort.signal});const text=await r.text();let body;try{body=JSON.parse(text)}catch{throw this.error('offline')}return{r,body}}finally{clearTimeout(timer)}}
 async loadConfig(){const {r,body:h}=await this.json('/health');const known=h.service==='ynx-faucetd'&&h.nativeSymbol==='YNXT'&&h.chainId===6423&&Number.isSafeInteger(h.defaultAmount)&&h.defaultAmount>0;this.config={ready:r.ok&&known&&h.ok===true&&h.upstreamOk===true&&h.fundingReady!==false,chainId:h.chainId,defaultAmount:known?h.defaultAmount:null,durable:h.idempotentRequests===true,rateLimit:h.rateLimit,rateLimitMax:h.rateLimitMax,rateLimitWindowSeconds:h.rateLimitWindowSeconds};return this.config;}
 async claim(address){if(this.inflight)throw this.error('blocked');this.inflight=true;try{if(!this.config?.ready)throw this.error('capability');this.restore();let p=this.pending;if(p?.state==='accepted')return p.receipt;if(p&&!p.durable&&p.state!=='prepared')throw this.error('legacyUncertain');if(!p){address=address.trim();try{normalizeRecipient(address)}catch{throw this.error('invalidAddress')}const bytes=new Uint8Array(16);this.crypto.getRandomValues(bytes);p={version:1,chainId:6423,address,amount:this.config.defaultAmount,requestId:'faucet_'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join(''),durable:this.config.durable,state:'prepared'};this.save(p)}
 // Do not silently downgrade a durable saved intent after a rollback.
 if(p.durable&&!this.config.durable)throw this.error('capability');p={...p,state:'sent'};this.save(p);let r,b;try{const response=await this.json('/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:p.address,amount:p.amount,...(p.durable?{requestId:p.requestId}:{})})});r=response.r;b=response.body}catch{throw this.error(p.durable?'offline':'legacyUncertain')}
 if(!r.ok){if(r.status===400){this.save({...p,state:'prepared'});this.storage.removeItem(this.key);this.pending=null;throw this.error('invalidAddress')}if(r.status===429){this.save({...p,state:'prepared'});throw this.error('rate')}if(r.status===409)throw this.error('blocked');throw this.error(p.durable?'capability':'legacyUncertain')}
 const tx=b.transaction,hash=b.transactionHash||tx?.hash;const valid=tx&&typeof hash==='string'&&/^(0x)?[0-9a-fA-F]{64}$/.test(hash)&&b.amount===p.amount&&tx.amount===p.amount&&b.nativeSymbol==='YNXT'&&tx.to===b.address&&b.address===normalizeRecipient(p.address)&&(!p.durable||b.requestId===p.requestId);if(!valid)throw this.error('badReceipt');this.save({...p,state:'accepted',transactionHash:hash,receipt:{replayed:b.replayed===true}});return this.pending.receipt;
 }finally{this.inflight=false}}
 newRequest(){if(this.pending&&this.pending.state!=='accepted')throw this.error('newBlocked');this.storage.removeItem(this.key);this.pending=null;}
}

// Same 20-byte Bech32 address format as internal/accountaddress.
export function normalizeRecipient(input){
 const value=input.trim();if(/^0x[0-9a-f]{40}$/i.test(value))return value.toLowerCase();
 if(/^ynx_[a-zA-Z0-9_]{3,80}$/.test(value))return value;
 if(value!==value.toLowerCase()&&value!==value.toUpperCase())throw Error('mixed address case');
 const v=value.toLowerCase(),alphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l';if(!v.startsWith('ynx1')||v.length!==42)throw Error('invalid address length');
 const data=Array.from(v.slice(4),x=>alphabet.indexOf(x));if(data.some(x=>x<0))throw Error('invalid address character');
 const hrp=[3,3,3,0,25,14,24],generators=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let check=1;
 for(const x of [...hrp,...data]){const top=check>>>25;check=((check&0x1ffffff)<<5)^x;for(let i=0;i<5;i++)if((top>>>i)&1)check^=generators[i]}
 if((check>>>0)!==1)throw Error('invalid checksum');let acc=0,bits=0,bytes=[];for(const x of data.slice(0,-6)){acc=((acc<<5)|x)&4095;bits+=5;while(bits>=8){bits-=8;bytes.push((acc>>>bits)&255)}}if(bits||bytes.length!==20)throw Error('invalid payload');return '0x'+bytes.map(x=>x.toString(16).padStart(2,'0')).join('');
}
