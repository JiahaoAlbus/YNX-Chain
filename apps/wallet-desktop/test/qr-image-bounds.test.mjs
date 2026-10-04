import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {decodeLocalQRText} from '../src/walletconnect-qr-decoder.mjs';
import {decodeWalletConnectQR} from '../src/walletconnect-qr-decoder.mjs';
import {decodePaymentRecipientQR} from '../src/payment-recipient.mjs';
import {decodeInvoiceReferenceQR} from '../src/wallet-invoice-reference-qr.mjs';
import {readQRImageBounds} from '../src/qr-image-bounds.mjs';
import {pngHeader,jpegHeader,webpHeader} from './helpers/qr-image-headers.mjs';
const image=(width,height)=>({isEmpty:()=>false,getSize:()=>({width,height}),toBitmap:()=>Buffer.alloc(width*height*4,255)});

test('oversized PNG, JPEG and all three WebP dimension headers refuse before calling native image decoding',()=>{
  for(const [mimeType,bytes]of [['image/png',pngHeader(4097,1)],['image/jpeg',jpegHeader(4097,1)],...['VP8X','VP8L','VP8 '].map(kind=>['image/webp',webpHeader(4097,1,kind)])]){
    let calls=0;assert.throws(()=>decodeLocalQRText({bytes,mimeType,createImage:()=>{calls++;return{isEmpty:()=>false,getSize:()=>({width:4097,height:1})}}}),{code:'INVALID_QR_DIMENSIONS'});
    assert.equal(calls,0,mimeType+': native decoder must not allocate first');
  }
});
test('all actual receiving, invoice and WalletConnect consumers enforce the same pre-decoder allocation gate',()=>{
  for(const decode of [decodePaymentRecipientQR,decodeInvoiceReferenceQR,decodeWalletConnectQR]){
    let calls=0;assert.throws(()=>decode({bytes:pngHeader(4097,1),mimeType:'image/png',createImage:()=>{calls++;throw Error('must not decode')}}),{code:'INVALID_QR_DIMENSIONS'});assert.equal(calls,0);
  }
});
test('matching bounded headers retain the pixel decoder boundary and original PNG/JPEG/WebP input types',()=>{
  for(const [mimeType,bytes]of [['image/png',pngHeader(2,1)],['image/jpeg',jpegHeader(2,1)],...['VP8X','VP8L','VP8 '].map(kind=>['image/webp',webpHeader(2,1,kind)])]){
    let calls=0;assert.equal(decodeLocalQRText({bytes,mimeType,createImage:()=>{calls++;return image(2,1)},decode:()=>({data:'controlled-public-text'})}),'controlled-public-text');assert.equal(calls,1);
  }
});
test('mislabeled, truncated or missing dimension headers fail before native decoding',()=>{
  for(const [mimeType,bytes]of [['image/jpeg',pngHeader()],['image/png',jpegHeader()],['image/webp',Buffer.alloc(20)],['image/png',pngHeader().subarray(0,24)],['image/jpeg',jpegHeader().subarray(0,9)],['image/jpeg',Buffer.from([255,216,255,218,0,2])]]){
    let calls=0;assert.throws(()=>decodeLocalQRText({bytes,mimeType,createImage:()=>{calls++;return image(1,1)},decode:()=>({data:'must not decode'})}),{code:'INVALID_QR_IMAGE'});assert.equal(calls,0);
  }
});
test('post-decode dimensions must still match the original bounded container',()=>{
  assert.throws(()=>decodeLocalQRText({bytes:pngHeader(2,1),mimeType:'image/png',createImage:()=>image(3,1),decode:()=>({data:'must not decode'})}),{code:'INVALID_QR_DIMENSIONS'});
});
test('actual encoded PNG dimensions are accepted without changing input bytes',async()=>{
  const bytes=await QRCode.toBuffer('controlled-public-reference',{type:'png',width:256});const original=Buffer.from(bytes);
  assert.equal(decodeLocalQRText({bytes,mimeType:'image/png',createImage:()=>image(256,256),decode:()=>({data:'controlled-public-reference'})}),'controlled-public-reference');assert.deepEqual(bytes,original);
});
test('dimension boundaries preserve the original 4096-side and 16-million-pixel policy without allocating pixels',()=>{
  for(const [mimeType,bytes]of [['image/png',pngHeader(4096,4096)],['image/jpeg',jpegHeader(4096,4096)],['image/webp',webpHeader(4096,4096)]])assert.deepEqual(readQRImageBounds(bytes,mimeType),{width:4096,height:4096});
  for(const bytes of [pngHeader(0,1),pngHeader(1,0),pngHeader(0xffffffff,1),pngHeader(1,0xffffffff)])assert.throws(()=>readQRImageBounds(bytes,'image/png'),{code:'INVALID_QR_DIMENSIONS'});
});
test('JPEG metadata and fill markers preserve baseline and progressive frame dimensions',()=>{
  for(const marker of [0xc0,0xc1,0xc2]){
    const frame=jpegHeader(32,16,marker),bytes=Buffer.concat([frame.subarray(0,2),Buffer.from([255,255,225,0,6,1,2,3,4]),frame.subarray(2)]);
    assert.deepEqual(readQRImageBounds(bytes,'image/jpeg'),{width:32,height:16});
  }
  for(const bytes of [Buffer.from([255,216,255,225,255,255]),Buffer.from([255,216,255,225,0,1]),Buffer.from([255,216,255,255]),Buffer.from([255,216,255,0])])assert.throws(()=>readQRImageBounds(bytes,'image/jpeg'),{code:'INVALID_QR_IMAGE'});
});
test('APNG frame declarations cannot bypass original canvas or native allocation limits',()=>{
  const control=Buffer.alloc(38);control.writeUInt32BE(26);control.write('fcTL',4);control.writeUInt32BE(4097,12);control.writeUInt32BE(1,16);
  let bytes=Buffer.concat([pngHeader(32,32).subarray(0,33),control,pngHeader().subarray(33)]);
  assert.throws(()=>readQRImageBounds(bytes,'image/png'),{code:'INVALID_QR_DIMENSIONS'});
  control.writeUInt32BE(33,12);bytes=Buffer.concat([pngHeader(32,32).subarray(0,33),control,pngHeader().subarray(33)]);
  assert.throws(()=>readQRImageBounds(bytes,'image/png'),{code:'INVALID_QR_IMAGE'});
  control.writeUInt32BE(16,12);control.writeUInt32BE(16,16);bytes=Buffer.concat([pngHeader(32,32).subarray(0,33),control,pngHeader().subarray(33)]);
  assert.deepEqual(readQRImageBounds(bytes,'image/png'),{width:32,height:32});
});
test('WebP extension canvas and nested animated payload dimensions are both bounded',()=>{
  function animated(frameWidth,payloadWidth){
    const frame=Buffer.alloc(16);frame.writeUIntLE(frameWidth-1,6,3);frame.writeUIntLE(15,9,3);
    const payload=webpHeader(payloadWidth,16,'VP8L').subarray(12),chunk=Buffer.alloc(8);chunk.write('ANMF');chunk.writeUInt32LE(frame.length+payload.length,4);
    const bytes=Buffer.concat([webpHeader(32,32),chunk,frame,payload]);bytes.writeUInt32LE(bytes.length-8,4);return bytes;
  }
  assert.deepEqual(readQRImageBounds(animated(16,16),'image/webp'),{width:32,height:32});
  assert.throws(()=>readQRImageBounds(animated(4097,16),'image/webp'),{code:'INVALID_QR_DIMENSIONS'});
  assert.throws(()=>readQRImageBounds(animated(16,4097),'image/webp'),{code:'INVALID_QR_DIMENSIONS'});
  assert.throws(()=>readQRImageBounds(animated(33,16),'image/webp'),{code:'INVALID_QR_IMAGE'});
});
test('truncated chunks and missing native headers refuse without allocating or reading outside the input',()=>{
  for(const mimeType of ['image/png','image/jpeg','image/webp'])for(let size=0;size<48;size++){
    const bytes=Buffer.alloc(size,255);assert.throws(()=>readQRImageBounds(bytes,mimeType),{code:'INVALID_QR_IMAGE'});
  }
  const bytes=webpHeader();bytes.writeUInt32LE(0xffffffff,16);assert.throws(()=>readQRImageBounds(bytes,'image/webp'),{code:'INVALID_QR_IMAGE'});
  const png=pngHeader();png.writeUInt32BE(0xffffffff,33);assert.throws(()=>readQRImageBounds(png,'image/png'),{code:'INVALID_QR_IMAGE'});
});
