export const PRIVATE_FILE_MAX_BYTES=1_048_576;
export class PrivateFileReadTooLarge extends Error{
  constructor(){super('Private Wallet file exceeds its read budget');this.code='PRIVATE_FILE_READ_TOO_LARGE'}
}
/** Read from an already-open private regular file. Keep the byte allocation
 * bounded even if another process grows that same inode after its stat check.
 * Never truncate, replace, unlink, parse, or log the encrypted/journal bytes.
 */
export async function readBoundedPrivateFile(handle,maxBytes=PRIVATE_FILE_MAX_BYTES){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>PRIVATE_FILE_MAX_BYTES)throw Error('Invalid private file read budget');
  const buffer=Buffer.alloc(maxBytes+1);let used=0;
  while(used<buffer.length){
    const length=Math.min(65_536,buffer.length-used);
    const result=await handle.read({buffer,offset:used,length,position:used});
    if(!Number.isSafeInteger(result?.bytesRead)||result.bytesRead<0||result.bytesRead>length)throw Error('Invalid private file read result');
    if(result.bytesRead===0)return buffer.subarray(0,used).toString('utf8');
    used+=result.bytesRead;if(used>maxBytes)throw new PrivateFileReadTooLarge();
  }
  throw new PrivateFileReadTooLarge();
}
