// PUBLIC test-only Electron/review model. No installed window or approval.
import {EventEmitter} from 'node:events';
const windows=new WeakMap(),borrows=new WeakSet();
export const BrowserWindow={fromWebContents:sender=>windows.get(sender)};
export const brandPUBLICBorrow=value=>{borrows.add(value);return value;};
export const isOriginalPQTransactionReviewBorrow=value=>borrows.has(value);
export function createPUBLICPeer(url){
  const sender=new EventEmitter();sender.mainFrame={url};sender.isDestroyed=()=>false;
  const window={isDestroyed:()=>false};windows.set(sender,window);
  return {sender,window,event:{sender,senderFrame:sender.mainFrame}};
}
