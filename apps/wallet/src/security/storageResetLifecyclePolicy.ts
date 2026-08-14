export type StorageResetAttempt=Readonly<{epoch:number}>;
export type StorageResetCurrent=Readonly<{
  epoch:number;
  appState:string|null;
  privacyReady:boolean;
  manifestPresent:boolean;
  storageErrorPresent:boolean;
}>;

export function assertStorageResetActive(attempt:StorageResetAttempt,current:StorageResetCurrent):void{
  if(attempt.epoch!==current.epoch)throw new Error("Wallet reset was invalidated by lock or privacy state");
  if(current.appState!=="active")throw new Error("Wallet reset was dismissed or moved to the background");
  if(!current.privacyReady)throw new Error("Wallet reset requires active screenshot protection");
  if(current.manifestPresent||!current.storageErrorPresent)throw new Error("Wallet reset is no longer bound to unreadable storage");
}
