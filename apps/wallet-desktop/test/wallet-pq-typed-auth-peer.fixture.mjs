// PUBLIC Electron surface only. Never an actual installed Window or approval.
import {EventEmitter} from 'node:events';
const windows=new WeakMap();
export const BrowserWindow={fromWebContents:sender=>windows.get(sender)};
export function createPUBLICPeer(url){
 const sender=new EventEmitter();sender.mainFrame={url};sender.isDestroyed=()=>false;
 windows.set(sender,{isDestroyed:()=>false});return{sender,senderFrame:sender.mainFrame};
}
