// CLI controller + real helper HTTP flow. This is not browser/rendering QA.
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {environment} from './test-support.mjs';

function ensure(condition,message){if(!condition)throw new Error(message);}
export async function runClientSmoke({origin,code,txId,priorReceiptId,allowNativeUnavailable=false}){
 const base=new URL(origin);ensure(base.origin===origin&&base.protocol==='http:'&&['127.0.0.1','[::1]'].includes(base.hostname),'numeric loopback helper origin required');
 const [htmlResponse,sourceResponse]=await Promise.all([fetch(origin+'/'),fetch(origin+'/app.js')]);ensure(htmlResponse.ok&&sourceResponse.ok,'compiled helper assets unavailable');
 const html=await htmlResponse.text(),source=await sourceResponse.text();
 const defaultTx=html.match(/id="tx-id"[^>]*value="([^"]+)"/)?.[1];
 const transport=async(path,options)=>{ensure(typeof path==='string'&&path.startsWith('/api/'),'only fixed helper API allowed');return fetch(origin+path,{...options,headers:{...options.headers,Origin:origin},signal:AbortSignal.any([options.signal,AbortSignal.timeout(60000)])});};
 const e=environment({html,source,ticket:false,txId:txId||defaultTx,fetch:transport});
 e.node('pair-code').value=code;await e.emit('pair-form','submit');ensure(!e.node('lookup-button').disabled,'pair/status handshake did not enable real client: '+e.node('notice').textContent);
 ensure(e.node('node-state').textContent.includes('仅 RPC 返回'),'node source was not explicitly RPC_ONLY');
 if(!allowNativeUnavailable)ensure(e.node('native-state').textContent.includes('通过内核'),'real native self-client did not verify: '+e.node('native-state').textContent);
 ensure(e.node('native-note').textContent.includes('浏览器 OS 身份：未验证'),'browser was promoted to native identity');
 await e.emit('lookup-form','submit');
 const savedId=e.node('meta-receipt').textContent,liveLevel=e.node('level-tag').textContent,raw=e.node('raw-report').textContent;
 ensure(/^[a-f0-9]{64}$/.test(savedId),'live client did not save receipt: '+e.node('notice').textContent);
 ensure(['RPC_ONLY','HEADER_VERIFIED','INCLUSION_VERIFIED'].includes(liveLevel),'unsupported funds-state claim');
 const id=priorReceiptId||savedId;e.node('receipt-id').value=id;await e.emit('history-form','submit');
 ensure(e.node('meta-receipt').textContent===id,'original receipt readback failed: '+e.node('notice').textContent);
 ensure(e.node('level-tag').textContent.startsWith('历史记录 · '),'saved receipt became current verification');
 ensure(!e.rows.some(row=>row.classList.contains('reached')),'historical snapshot gained a live green level');
 if(!priorReceiptId)ensure(e.node('raw-report').textContent===raw,'saved raw report bytes changed on readback');
 const historicalRaw=e.node('raw-report').textContent;
 const oldTicket=e.storage.get('ynxNetworkTicket');await e.emit('revoke','click');ensure(!e.storage.has('ynxNetworkTicket')&&e.node('lookup-button').disabled,'client revoke did not invalidate session');
 const denied=await fetch(origin+'/api/receipts',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+oldTicket},body:'{}'});ensure(denied.status===401,'revoked ticket retained backend access');
 return {classification:'local-controller-real-helper-http',browserOrGUI:false,sourceSHA256:createHash('sha256').update(source).digest('hex'),receiptId:savedId,historicalReceiptId:id,liveLevel,rawReportSHA256:createHash('sha256').update(raw).digest('hex'),historicalRawReportSHA256:createHash('sha256').update(historicalRaw).digest('hex'),historicalNoAuthority:true,nativeBrowserIdentityVerified:false,revoked:true};
}
async function main(){
 const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){ensure(args[i]?.startsWith('--')&&args[i+1],'usage: --origin <loopback> --code-file <private file> [--tx <hash>] [--prior-receipt-id <id>]');options[args[i]]=args[i+1];}
 ensure(options['--origin']&&options['--code-file'],'origin and private code file required');const info=await lstat(options['--code-file']);ensure(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,'code file must be private regular file');if(process.geteuid)ensure(info.uid===process.geteuid(),'code file owner mismatch');
 const code=(await readFile(options['--code-file'],'utf8')).trim();ensure(code.length>0&&code.length<=512,'invalid one-use code file');
 const result=await runClientSmoke({origin:options['--origin'],code,txId:options['--tx'],priorReceiptId:options['--prior-receipt-id']});process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error('Client HTTP smoke failed: '+error.message);process.exitCode=1;});
