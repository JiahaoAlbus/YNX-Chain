export type SecureStringStore=Readonly<{
  getItemAsync:(key:string)=>Promise<string|null>;
  setItemAsync:(key:string,value:string)=>Promise<void>;
  deleteItemAsync:(key:string)=>Promise<void>;
}>;

export type VerifiedProductSessionStorage=Readonly<{
  securityLevel:"os-protected";
  get:(key:string)=>Promise<string|null>;
  set:(key:string,value:string)=>Promise<void>;
  remove:(key:string)=>Promise<void>;
}>;

let sharedNativeStorageTail:Promise<void>=Promise.resolve();
export class NativeStorageOwnerExpiredError extends Error{readonly code="NATIVE_STORAGE_OWNER_EXPIRED";constructor(){super("Native Product Session storage operation lease expired.");}}
export function isNativeStorageOwnerExpiredError(value:unknown):value is NativeStorageOwnerExpiredError{return value instanceof NativeStorageOwnerExpiredError;}

export function createVerifiedProductSessionStorage(input:Readonly<{
  store:SecureStringStore;
  mapKey:(key:string)=>string;
  isUncertain:()=>boolean;
  markUncertain:()=>void;
  isOwnerActive?:()=>boolean;
}>):VerifiedProductSessionStorage{
  const guard=()=>{if(input.isUncertain())throw new Error("Native identity storage is uncertain; restart after secure storage is repaired.");if(input.isOwnerActive&&!input.isOwnerActive())throw new NativeStorageOwnerExpiredError();};
  const serial=<T>(operation:()=>Promise<T>):Promise<T>=>{
    const run=sharedNativeStorageTail.then(operation,operation);
    sharedNativeStorageTail=run.then(()=>undefined,()=>undefined);
    return run;
  };
  const protectedOperation=<T>(operation:()=>Promise<T>):Promise<T>=>serial(async()=>{
    try{guard();const result=await operation();guard();return result;}
    catch(error){if(!(error instanceof NativeStorageOwnerExpiredError))input.markUncertain();throw error;}
  });
  return Object.freeze({
    securityLevel:"os-protected" as const,
    get:(key:string)=>protectedOperation(async()=>await input.store.getItemAsync(input.mapKey(key))),
    set:(key:string,value:string)=>protectedOperation(async()=>{
      const mapped=input.mapKey(key);
      await input.store.setItemAsync(mapped,value);
      const readback=await input.store.getItemAsync(mapped);
      if(readback!==value)throw new Error("Secure Product Session storage did not preserve the requested value.");
    }),
    remove:(key:string)=>protectedOperation(async()=>{
      const mapped=input.mapKey(key);
      await input.store.deleteItemAsync(mapped);
      const readback=await input.store.getItemAsync(mapped);
      if(readback!==null)throw new Error("Secure Product Session storage did not remove the requested value.");
    }),
  });
}
