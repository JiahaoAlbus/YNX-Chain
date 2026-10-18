// Cosmetic native Save-panel options only. No implicit save path, file write,
// download admission, key operation or new IPC/renderer authority is added.
export function installReceivingPNGDownloadOptions(window,expectedURL){
 const contents=window.webContents,session=contents.session;
 const listener=(_event,item,initiator)=>{
  try{
   if(initiator!==contents||contents.isDestroyed()||contents.getURL()!==expectedURL)return;
   const url=item.getURL(),name=item.getFilename();
   if(typeof url!=='string'||url.length>8*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url))return;
   if(typeof name!=='string'||! /^(?:YNX-Testnet|BTC-[a-z0-9-]+|TRON-[a-z0-9-]+)-receive-[A-Za-z0-9]+\.png$/.test(name))return;
   // Electron otherwise derives a huge title from the full data: URL. Retain
   // every existing option, filename, chosen folder and user confirmation.
   item.setSaveDialogOptions({...item.getSaveDialogOptions(),title:'YNX Wallet — PNG'});
  }catch{/* Options failure cannot authorize, cancel or retry a download. */}
 };
 session.on('will-download',listener);
 const dispose=()=>session.off('will-download',listener);
 window.once('closed',dispose);return dispose;
}
