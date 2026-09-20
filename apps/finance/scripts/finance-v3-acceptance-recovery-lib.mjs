import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';

export const sha256=body=>createHash('sha256').update(body).digest('hex');

function octal(value,width){
  const text=value.toString(8);
  if(text.length>width-1)throw new Error('FINANCE_RECOVERY_TAR_FIELD_OVERFLOW');
  return `${text.padStart(width-1,'0')}\0`;
}

function writeString(target,offset,length,value){
  const body=Buffer.from(value);
  if(body.length>length)throw new Error(`FINANCE_RECOVERY_TAR_PATH_TOO_LONG:${value}`);
  body.copy(target,offset);
}

function assertPath(path){
  if(!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..')){
    throw new Error(`FINANCE_RECOVERY_UNSAFE_PATH:${path}`);
  }
}

function header(path,size,mode,mtime){
  assertPath(path);
  const out=Buffer.alloc(512);
  const split=path.length<=100?['',path]:[path.slice(0,path.lastIndexOf('/')),path.slice(path.lastIndexOf('/')+1)];
  if(Buffer.byteLength(split[0])>155||Buffer.byteLength(split[1])>100)throw new Error(`FINANCE_RECOVERY_TAR_PATH_TOO_LONG:${path}`);
  writeString(out,0,100,split[1]);
  writeString(out,100,8,octal(mode,8));
  writeString(out,108,8,octal(0,8));
  writeString(out,116,8,octal(0,8));
  writeString(out,124,12,octal(size,12));
  writeString(out,136,12,octal(mtime,12));
  out.fill(0x20,148,156);
  out[156]='0'.charCodeAt(0);
  writeString(out,257,6,'ustar\0');
  writeString(out,263,2,'00');
  writeString(out,265,32,'root');
  writeString(out,297,32,'root');
  writeString(out,345,155,split[0]);
  const checksum=[...out].reduce((sum,value)=>sum+value,0);
  writeString(out,148,8,`${checksum.toString(8).padStart(6,'0')}\0 `);
  return out;
}

export function createTarGz(entries,{mtime}){
  const seconds=Math.floor(new Date(mtime).getTime()/1000);
  if(!Number.isSafeInteger(seconds)||seconds<0)throw new Error('FINANCE_RECOVERY_INVALID_MTIME');
  const seen=new Set(),chunks=[];
  for(const entry of [...entries].sort((a,b)=>a.path.localeCompare(b.path))){
    assertPath(entry.path);
    if(seen.has(entry.path))throw new Error(`FINANCE_RECOVERY_DUPLICATE_PATH:${entry.path}`);
    seen.add(entry.path);
    if(!Buffer.isBuffer(entry.body))throw new Error(`FINANCE_RECOVERY_INVALID_BODY:${entry.path}`);
    const mode=entry.mode===0o755?0o755:0o644;
    chunks.push(header(entry.path,entry.body.length,mode,seconds),entry.body);
    const remainder=entry.body.length%512;
    if(remainder)chunks.push(Buffer.alloc(512-remainder));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks),{level:9,mtime:0});
}

function parseOctal(field,label){
  const text=field.toString('ascii').replace(/\0.*$/s,'').trim();
  if(!/^[0-7]+$/.test(text))throw new Error(`FINANCE_RECOVERY_INVALID_TAR_${label}`);
  return Number.parseInt(text,8);
}

export function parseTarGz(archive){
  const tar=gunzipSync(archive),entries=[],seen=new Set();
  let offset=0;
  while(offset+512<=tar.length){
    const block=tar.subarray(offset,offset+512);
    if(block.every(value=>value===0))break;
    const stored=parseOctal(block.subarray(148,156),'CHECKSUM');
    const check=Buffer.from(block);check.fill(0x20,148,156);
    if([...check].reduce((sum,value)=>sum+value,0)!==stored)throw new Error('FINANCE_RECOVERY_TAR_CHECKSUM_MISMATCH');
    const name=block.subarray(0,100).toString('utf8').replace(/\0.*$/s,'');
    const prefix=block.subarray(345,500).toString('utf8').replace(/\0.*$/s,'');
    const path=prefix?`${prefix}/${name}`:name;
    assertPath(path);
    if(seen.has(path))throw new Error(`FINANCE_RECOVERY_DUPLICATE_PATH:${path}`);
    seen.add(path);
    if(block[156]!==48)throw new Error(`FINANCE_RECOVERY_NON_REGULAR_ENTRY:${path}`);
    const size=parseOctal(block.subarray(124,136),'SIZE');
    const mode=parseOctal(block.subarray(100,108),'MODE')&0o777;
    const start=offset+512,end=start+size;
    if(end>tar.length)throw new Error(`FINANCE_RECOVERY_TRUNCATED_ENTRY:${path}`);
    entries.push({path,body:Buffer.from(tar.subarray(start,end)),mode});
    offset=start+Math.ceil(size/512)*512;
  }
  return entries;
}
