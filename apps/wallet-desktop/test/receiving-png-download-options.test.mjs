import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {installReceivingPNGDownloadOptions} from '../src/receiving-png-download-options.mjs';
const expectedURL='file:///PUBLIC/Wallet/src/index.html';
function fixture(){const window=new EventEmitter(),session=new EventEmitter();window.webContents={session,getURL:()=>expectedURL,isDestroyed:()=>false};const options={defaultPath:'/PUBLIC/user-chosen/receive.png',buttonLabel:'Existing save label'},item={getURL:()=> 'data:image/png;base64,aGVsbG8=',getFilename:()=> 'YNX-Testnet-receive-ynx1public.png',getSaveDialogOptions:()=>options,setSaveDialogOptions:value=>{item.saved=value;}};return {window,session,item,options};}
test('normal main window installs native receiving-PNG save options before use',()=>{
 const f=fixture(),text=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),start=text.indexOf('  mainWindow = window;'),end=text.indexOf('  const initialAccount =',start);assert.ok(start>=0&&end>start);
 Object.assign(f.session,{setPermissionCheckHandler(){},setPermissionRequestHandler(){}});
 runInNewContext(text.slice(start,end),{window:f.window,mainWindow:null,installReceivingPNGDownloadOptions,path,pathToFileURL,directory:'/PUBLIC/Wallet/src',keyAccess:{setFocused(){},lock(){}},recipientCameraPermission:{allows(){}},powerMonitor:new EventEmitter(),originalAdmissionExit:{close(){}}});
 f.session.emit('will-download',{},f.item,f.window.webContents);assert.equal(f.item.saved?.title,'YNX Wallet — PNG');
});
test('receiving PNG title is concise while existing folder, filename and confirmation options remain untouched',()=>{
 for(const name of ['YNX-Testnet-receive-ynx1public.png','BTC-testnet-receive-tb1public.png','TRON-nile-receive-TPublic.png']){const f=fixture();f.item.getFilename=()=>name;installReceivingPNGDownloadOptions(f.window,expectedURL);f.session.emit('will-download',{},f.item,f.window.webContents);assert.deepEqual(f.item.saved,{...f.options,title:'YNX Wallet — PNG'});assert.equal(f.item.getFilename(),name);}
});
test('foreign sender/navigation/nonreceiving files and oversized data never gain download options',()=>{
 for(const mode of ['sender','navigation','destroyed','filename','path','url','oversize']){const f=fixture();installReceivingPNGDownloadOptions(f.window,expectedURL);let sender=f.window.webContents;
  if(mode==='sender')sender={};if(mode==='navigation')f.window.webContents.getURL=()=> 'https://foreign.invalid/';if(mode==='destroyed')f.window.webContents.isDestroyed=()=>true;
  if(mode==='filename')f.item.getFilename=()=> 'private-backup.png';if(mode==='path')f.item.getFilename=()=> '../YNX-Testnet-receive-ynx1public.png';if(mode==='url')f.item.getURL=()=> 'https://foreign.invalid/receive.png';if(mode==='oversize')f.item.getURL=()=> 'data:image/png;base64,'+'a'.repeat(8*1024*1024);
  f.session.emit('will-download',{},f.item,sender);assert.equal(f.item.saved,undefined,mode);
 }
});
test('closing the owning window removes only its download listener and options errors do not cancel or retry',()=>{
 const f=fixture();let other=0;f.session.on('will-download',()=>other++);installReceivingPNGDownloadOptions(f.window,expectedURL);f.item.getSaveDialogOptions=()=>{throw Error('PUBLIC_OPTIONS_FAILURE');};f.session.emit('will-download',{},f.item,f.window.webContents);assert.equal(other,1);assert.equal(f.item.saved,undefined);f.window.emit('closed');assert.equal(f.session.listenerCount('will-download'),1);
});
