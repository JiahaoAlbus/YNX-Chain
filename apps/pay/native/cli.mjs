#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativePayBusinessClient,nativePaySummary} from './pay-business-client.mjs';

const usage=`YNX Native Pay QA client (no signing keys or default service authority)
Usage: ynx-pay-native --runtime /absolute/original-source-runtime.mjs COMMAND ARGS
  invoice MERCHANT INVOICE       intent INTENT
  create-intent PRODUCT SOURCE_ORDER    lookup-intent PRODUCT SOURCE_ORDER
  terms-review INTENT            terms-submit INTENT ORIGINAL_MAIN_HASH
  pay-review MERCHANT INVOICE    pay-submit MERCHANT INVOICE ORIGINAL_MAIN_HASH
  refund-review MERCHANT INVOICE REFUND_ID ATOMS
  refund-submit MERCHANT INVOICE ORIGINAL_MAIN_HASH
  events MERCHANT INVOICE        recover MERCHANT INVOICE [ORIGINAL_NATIVE_HASH]   recover-intent INTENT
The *-submit commands request Wallet Pay broadcast review only; they never send.
Wallet's existing UI/Auth approves reviews; this client has no approve command.
Runtime must export openNativePayRuntime() using original qualified Main/Source.
--diagnose runs without authority, network, keys, funds or a seeded demo.`;
export async function runNativePayCLI(args,{write=value=>process.stdout.write(value+'\n')}={}){
 if(args.length===0||args[0]==='--help'){write(usage);return 0;}
 if(args[0]==='--diagnose'){write(JSON.stringify({client:'YNX Native Pay',runtime:'not-supplied',privateSource:false,mainApproval:false,signing:false,submission:false,installed:false,deployed:false}));return 0;}
 if(args[0]!=='--runtime'||!path.isAbsolute(args[1]??''))throw Object.assign(Error('Original private runtime module is required.'),{code:'NATIVE_PAY_SOURCE_UNAVAILABLE'});
 const [,,command,...values]=args,required={invoice:[2],intent:[1],'create-intent':[2],'lookup-intent':[2],'terms-review':[1],'terms-submit':[2],'pay-review':[2],'pay-submit':[3],'refund-review':[4],'refund-submit':[3],events:[2],recover:[2,3],'recover-intent':[1]};
 if(!required[command]?.includes(values.length))throw Object.assign(Error(usage),{code:'NATIVE_PAY_COMMAND_INVALID'});
 const module=await import(pathToFileURL(args[1]).href);if(typeof module.openNativePayRuntime!=='function')throw Object.assign(Error('Original Source runtime entry unavailable.'),{code:'NATIVE_PAY_SOURCE_UNAVAILABLE'});
 const runtime=await module.openNativePayRuntime();
 try{
  const client=new NativePayBusinessClient(runtime),methods={invoice:'openInvoice',intent:'openIntent','create-intent':'createInvoiceIntent','lookup-intent':'lookupOriginalInvoiceIntent','terms-review':'reviewMerchantTerms','terms-submit':'submitMerchantTerms','pay-review':'reviewPayment','pay-submit':'submitPayment','refund-review':'reviewRefund','refund-submit':'submitRefund',events:'syncNotifications',recover:'recoverInvoice','recover-intent':'recoverIntent'};
  try{const state=await client[methods[command]](...values);write(JSON.stringify(nativePaySummary(state)));return 0;}catch(error){const state=client.snapshot();write(JSON.stringify({...nativePaySummary(state),code:error.code??'NATIVE_PAY_OPERATION_UNAVAILABLE'}));return 2;}
 }finally{if(typeof runtime?.close==='function')await runtime.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{process.exitCode=await runNativePayCLI(process.argv.slice(2));}
 catch(error){process.stderr.write(JSON.stringify({phase:'unavailable',code:error.code??'NATIVE_PAY_OPERATION_UNAVAILABLE',recoveryOnly:false})+'\n');process.exitCode=2;}
}
