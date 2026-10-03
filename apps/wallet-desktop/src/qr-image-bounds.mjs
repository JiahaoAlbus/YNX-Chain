export const QR_IMAGE_MAX_DIMENSION=4096;
export const QR_IMAGE_MAX_PIXELS=16*1024*1024;
const invalid=()=>{throw Object.assign(Error('Choose a valid PNG, JPEG or WebP QR image'),{code:'INVALID_QR_IMAGE'})};
export function assertQRImageDimensions(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>QR_IMAGE_MAX_DIMENSION||height>QR_IMAGE_MAX_DIMENSION||width*height>QR_IMAGE_MAX_PIXELS){
    throw Object.assign(Error('QR image dimensions exceed the local decoder limit'),{code:'INVALID_QR_DIMENSIONS'});
  }
  return Object.freeze({width,height});
}
// Metadata-only preflight. Never inflate or allocate image pixels here. Native
// codec remains responsible for compressed data; recheck its resulting size.
export function readQRImageBounds(bytes,mimeType){
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>10*1024*1024)invalid();
  if(mimeType==='image/png')return pngBounds(bytes);
  if(mimeType==='image/jpeg')return jpegBounds(bytes);
  if(mimeType==='image/webp')return webpBounds(bytes);
  invalid();
}
function pngBounds(bytes){
  if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')invalid();
  const bounds=assertQRImageDimensions(bytes.readUInt32BE(16),bytes.readUInt32BE(20));
  let position=33;
  while(position<bytes.length){
    if(position+12>bytes.length)invalid();
    const size=bytes.readUInt32BE(position),end=position+12+size;if(end>bytes.length)invalid();
    const type=bytes.toString('ascii',position+4,position+8),data=position+8;
    if(type==='fcTL'){
      if(size!==26)invalid();const frame=assertQRImageDimensions(bytes.readUInt32BE(data+4),bytes.readUInt32BE(data+8));
      if(frame.width+bytes.readUInt32BE(data+12)>bounds.width||frame.height+bytes.readUInt32BE(data+16)>bounds.height)invalid();
    }
    if(type==='IEND'){if(size!==0)invalid();return bounds}
    position=end;
  }
  invalid();
}
function jpegBounds(bytes){
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)invalid();let position=2;
  while(position<bytes.length){
    if(bytes[position++]!==0xff)invalid();while(bytes[position]===0xff)position++;
    if(position>=bytes.length)invalid();const marker=bytes[position++];
    if(marker===0x00||marker===0xd8||marker===0xd9||marker===0xda)invalid();
    if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
    if(position+2>bytes.length)invalid();const size=bytes.readUInt16BE(position);if(size<2||position+size>bytes.length)invalid();
    if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)){
      if(size<8||size!==8+3*bytes[position+7])invalid();return assertQRImageDimensions(bytes.readUInt16BE(position+5),bytes.readUInt16BE(position+3));
    }
    position+=size;
  }
  invalid();
}
function webpBounds(bytes){
  if(bytes.length<20||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')invalid();
  const end=bytes.readUInt32LE(4)+8;if(end>bytes.length||end<20)invalid();let bounds;
  function chunks(start,stop,nested=false){
    let position=start;
    while(position<stop){
      if(position+8>stop)invalid();const kind=bytes.toString('ascii',position,position+4),size=bytes.readUInt32LE(position+4),data=position+8,next=data+size+(size%2);
      if(next>stop)invalid();let image;
      if(kind==='VP8X'){
        if(nested||size!==10)invalid();image=assertQRImageDimensions(1+bytes.readUIntLE(data+4,3),1+bytes.readUIntLE(data+7,3));
      }else if(kind==='VP8L'){
        if(size<5||bytes[data]!==0x2f)invalid();const bits=bytes.readUInt32LE(data+1);image=assertQRImageDimensions(1+(bits&0x3fff),1+((bits>>>14)&0x3fff));
      }else if(kind==='VP8 '){
        if(size<10||(bytes[data]&1)!==0||bytes[data+3]!==0x9d||bytes[data+4]!==1||bytes[data+5]!==0x2a)invalid();
        image=assertQRImageDimensions(bytes.readUInt16LE(data+6)&0x3fff,bytes.readUInt16LE(data+8)&0x3fff);
      }else if(kind==='ANMF'){
        if(nested||size<16||!bounds)invalid();const frame=assertQRImageDimensions(1+bytes.readUIntLE(data+6,3),1+bytes.readUIntLE(data+9,3));
        if(frame.width+2*bytes.readUIntLE(data,3)>bounds.width||frame.height+2*bytes.readUIntLE(data+3,3)>bounds.height)invalid();
        chunks(data+16,data+size,true);
      }
      if(image&&!nested){bounds??=image}
      position=next;
    }
  }
  chunks(12,end);if(!bounds)invalid();return bounds;
}
