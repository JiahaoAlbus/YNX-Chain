import {pngHeader} from "./helpers/qr-image-headers.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {decodeLocalQRText,decodeWalletConnectQR} from '../src/walletconnect-qr-decoder.mjs';
import {decodePaymentRecipientQR} from '../src/payment-recipient.mjs';
import {decodeInvoiceReferenceQR} from '../src/wallet-invoice-reference-qr.mjs';

const input=pixels=>({bytes:pngHeader(pixels.length/4,1),mimeType:'image/png',createImage:()=>({isEmpty:()=>false,getSize:()=>({width:pixels.length/4,height:1}),toBitmap:()=>pixels})});
test('opaque colors retain exact BGRA channel order while premultiplied alpha composites onto white',()=>{
  const pixels=Buffer.from([120,80,20,255,60,40,10,128,0,0,0,0]);
  const original=Buffer.from(pixels);
  assert.equal(decodeLocalQRText({...input(pixels),decode:(rgba,width,height,options)=>{
    assert.equal(width,3);assert.equal(height,1);assert.deepEqual(options,{inversionAttempts:'attemptBoth'});
    assert.deepEqual([...rgba],[20,80,120,255,137,167,187,255,255,255,255,255]);return {data:'controlled-public-text'};
  }}),'controlled-public-text');assert.deepEqual(pixels,original);
});
function transparentQR(text){
  const qr=QRCode.create(text,{errorCorrectionLevel:'M'}),scale=8,margin=4,width=(qr.modules.size+margin*2)*scale;
  const pixels=Buffer.alloc(width*width*4);
  for(let y=0;y<qr.modules.size;y++)for(let x=0;x<qr.modules.size;x++)if(qr.modules.get(y,x)){
    for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++)pixels.set([0,0,0,255],(((y+margin)*scale+dy)*width+(x+margin)*scale+dx)*4);
  }
  return{bytes:pngHeader(width,width),mimeType:'image/png',createImage:()=>({isEmpty:()=>false,getSize:()=>({width,height:width}),toBitmap:()=>pixels})};
}
test('transparent black receiving QR decodes to the original public account only',()=>{
  const account='ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt';
  const result=decodePaymentRecipientQR(transparentQR(`ynx:${account}?chainId=ynx_6423-1&asset=YNXT`));
  assert.equal(result.ynxAccount,account);assert.equal(result.chainId,'ynx_6423-1');
  assert.deepEqual(Object.keys(result).sort(),['account','asset','chainId','kind','ynxAccount']);
});
test('transparent black invoice and pairing QR preserve local reference-only decoding',()=>{
  const invoice=decodeInvoiceReferenceQR(transparentQR('ynxpay://invoice/invoice-original-001'));
  assert.deepEqual(invoice,{invoiceID:'invoice-original-001',decodedLocally:true,uploaded:false});
  const uri='wc:'+'a'.repeat(64)+'@2?relay-protocol=irn&symKey='+'b'.repeat(64);
  assert.deepEqual(decodeWalletConnectQR(transparentQR(uri)),{uri,format:'qr_code',decodedLocally:true,uploaded:false});
});
test('alpha repair does not widen original receiving-network or invoice-action validation',()=>{
  const account='ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt';
  for(const uri of [`ynx:${account}?chainId=ynx_1-1&asset=YNXT`,`ynx:${account}?chainId=ynx_6423-1&asset=YNXT&amount=25`]){
    assert.throws(()=>decodePaymentRecipientQR(transparentQR(uri)),{code:'INVALID_PAYMENT_RECIPIENT'});
  }
  assert.throws(()=>decodeInvoiceReferenceQR(transparentQR('ynxpay://invoice/invoice-original-001?amount=25')));
  assert.throws(()=>decodeWalletConnectQR(transparentQR('https://untrusted.invalid')),{code:'INVALID_WALLETCONNECT_QR'});
});
