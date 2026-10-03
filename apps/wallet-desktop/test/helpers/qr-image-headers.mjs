// Metadata fixtures for an injected image boundary, not valid compressed files.
export function pngHeader(width=1,height=1){
  const bytes=Buffer.alloc(45);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);
  bytes[24]=8;bytes[25]=6;bytes.write('IEND',37);return bytes;
}
export function jpegHeader(width=1,height=1,marker=0xc0){
  const bytes=Buffer.from([0xff,0xd8,0xff,marker,0,11,8,0,0,0,0,1,1,0x11,0,0xff,0xd9]);
  bytes.writeUInt16BE(height,7);bytes.writeUInt16BE(width,9);return bytes;
}
export function webpHeader(width=1,height=1,kind='VP8X'){
  const data=Buffer.alloc(kind==='VP8L'?5:10);
  if(kind==='VP8X'){data.writeUIntLE(width-1,4,3);data.writeUIntLE(height-1,7,3)}
  if(kind==='VP8L'){data[0]=0x2f;data.writeUInt32LE(((height-1)<<14)|(width-1),1)}
  if(kind==='VP8 '){data.set([0x9d,1,0x2a],3);data.writeUInt16LE(width,6);data.writeUInt16LE(height,8)}
  const bytes=Buffer.alloc(20+data.length+(data.length%2));bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WEBP',8);bytes.write(kind,12);bytes.writeUInt32LE(data.length,16);data.copy(bytes,20);return bytes;
}
