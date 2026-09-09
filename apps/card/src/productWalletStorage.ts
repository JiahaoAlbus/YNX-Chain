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

export function createVerifiedProductSessionStorage(input:Readonly<{
  store:SecureStringStore;
  mapKey:(key:string)=>string;
  isUncertain:()=>boolean;
  markUncertain:()=>void;
}>):VerifiedProductSessionStorage{
  let tail:Promise<void>=Promise.resolve();
  const guard=()=>{if(input.isUncertain())throw new Error("Native identity storage is uncertain; restart after secure storage is repaired.");};
  const serial=<T>(operation:()=>Promise<T>):Promise<T>=>{
    const run=tail.then(operation,operation);
    tail=run.then(()=>undefined,()=>undefined);
    return run;
  };
  const protectedOperation=<T>(operation:()=>Promise<T>):Promise<T>=>serial(async()=>{
    try{guard();const result=await operation();guard();return result;}
    catch(error){input.markUncertain();throw error;}
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
