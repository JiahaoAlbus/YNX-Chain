// PUBLIC test-only Electron model; not a native window or user approval.
import {EventEmitter} from 'node:events';
const windows=new WeakMap();
export const BrowserWindow={fromWebContents:sender=>windows.get(sender)};
export function bindPublicWindow(sender){const window={isDestroyed:()=>false};windows.set(sender,window);return window;}
export function createPublicWalletEvent(){const sender=new EventEmitter();sender.isDestroyed=()=>false;sender.mainFrame={url:new URL('../src/index.html',import.meta.url).href};bindPublicWindow(sender);return{sender,senderFrame:sender.mainFrame};}
