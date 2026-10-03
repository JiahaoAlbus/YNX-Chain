import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import QRCode from 'qrcode';
import {decodePaymentRecipientQR} from '../src/payment-recipient.mjs';
import {decodeInvoiceReferenceQR} from '../src/wallet-invoice-reference-qr.mjs';
import {decodeWalletConnectQR} from '../src/walletconnect-qr-decoder.mjs';

const {app,nativeImage,BrowserWindow}=createRequire(import.meta.url)('electron');
const profile=process.env.YNX_QR_CODEC_QA_PROFILE;
if(!profile?.startsWith('/tmp/ynx-wallet-image-codec-')||profile.includes('..'))throw Error('An isolated temporary QA profile is required');
app.setPath('userData',profile);app.disableHardwareAcceleration();
// No BrowserWindow, Wallet startup, provider, RPC, keys or user images. Exercise
// Electron's real native PNG decoder and the production QR consumers only.
const account='ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt';
const evm='0x84bc88971971078d450ac7cc31d9a4775d6e3065';
const receiving=`ynx:${account}?chainId=ynx_6423-1&asset=YNXT`;
const invoice='ynxpay://invoice/invoice-original-001';
const pairing='wc:'+'a'.repeat(64)+'@2?relay-protocol=irn&symKey='+'b'.repeat(64);
const results=[];
try{
  for(const [variant,color] of [
    ['opaque',{dark:'#002FA7FF',light:'#FFFFFFFF'}],
    ['black-transparent-background',{dark:'#000000FF',light:'#FFFFFF00'}],
    ['transparent-background',{dark:'#002FA7FF',light:'#FFFFFF00'}],
    ['translucent-background',{dark:'#002FA7FF',light:'#FFFFFF80'}],
    ['jpeg',{dark:'#002FA7FF',light:'#FFFFFFFF'}],
  ])for(const [kind,text,decode] of [['receive',receiving,decodePaymentRecipientQR],['invoice',invoice,decodeInvoiceReferenceQR],['pairing',pairing,decodeWalletConnectQR]]){
    const png=await QRCode.toBuffer(text,{type:'png',width:512,margin:4,errorCorrectionLevel:'M',color});
    const bytes=variant==='jpeg'?nativeImage.createFromBuffer(png).toJPEG(90):png;
    const image=nativeImage.createFromBuffer(bytes);
    const record={variant,kind,imageBytes:bytes.length,dimensions:image.getSize(),cornerBGRA:[...image.toBitmap().subarray(0,4)]};
    try{
      const result=decode({bytes,mimeType:variant==='jpeg'?'image/jpeg':'image/png',createImage:buffer=>nativeImage.createFromBuffer(buffer)});
      if(kind==='receive'){assert.equal(result.account,evm);assert.equal(result.ynxAccount,account);assert.equal(result.chainId,'ynx_6423-1')}
      if(kind==='invoice'){assert.equal(result.invoiceID,'invoice-original-001');assert.equal(result.decodedLocally,true);assert.equal(result.uploaded,false)}
      if(kind==='pairing'){assert.equal(result.uri,pairing);assert.equal(result.decodedLocally,true);assert.equal(result.uploaded,false)}
      results.push({...record,pass:true});
    }catch(error){results.push({...record,pass:false,code:error.code??error.name});}
  }
  for(const [kind,text,decode,code] of [
    ['wrong-network',receiving.replace('6423','1'),decodePaymentRecipientQR,'INVALID_PAYMENT_RECIPIENT'],
    ['receiving-amount',receiving+'&amount=25',decodePaymentRecipientQR,'INVALID_PAYMENT_RECIPIENT'],
    ['invoice-action',invoice+'?amount=25',decodeInvoiceReferenceQR,'PAY_INVALID_REFERENCE'],
    ['pairing-url','https://untrusted.invalid',decodeWalletConnectQR,'INVALID_WALLETCONNECT_QR'],
  ]){
    const bytes=await QRCode.toBuffer(text,{type:'png',width:512,margin:4,color:{dark:'#000000FF',light:'#FFFFFF00'}});
    try{assert.throws(()=>decode({bytes,mimeType:'image/png',createImage:buffer=>nativeImage.createFromBuffer(buffer)}),{code});results.push({kind,expectedRefusal:true,pass:true})}
    catch(error){results.push({kind,expectedRefusal:true,pass:false,code:error.code??error.name})}
  }
  assert.equal(app.getPath('userData'),profile);assert.equal(BrowserWindow.getAllWindows().length,0);
  console.log(JSON.stringify({schemaVersion:2,electronVersion:process.versions.electron,platform:process.platform,controlledInput:true,nativeImage:true,windowOpened:false,walletNetworkingInvoked:false,results},null,2));
  app.exit(results.every(result=>result.pass)?0:1);
}catch(error){console.error(error);app.exit(1)}
