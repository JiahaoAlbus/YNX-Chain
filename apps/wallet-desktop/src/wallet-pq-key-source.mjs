const fail=code=>{throw Object.assign(new Error(code),{code});};
/** Normal-main adapter for the SDK's sole dual-key implementation. Supply all
 * dependencies from protected main custody, never IPC, ENV or file metadata.
 * A backup preview cannot select its expected account/network/public keys.
 * The repository must use the existing protected Vault; no renderer key store
 * or alternative crypto implementation is constructed here. */
export function createPQKeyPreparationSource({sdk,repository,getOriginalNetwork,getRegisteredBinding,readRestoreInput}){
  for(const name of ['createPQWalletKeyHandle','readPQWalletKeyPublic','restorePQWalletKeyHandle','assertPQPublicBindingMatches','validatePQNetworkBinding','destroyPQWalletKeyHandle','readPQWalletKeyCleanupOutcome'])if(typeof sdk?.[name]!=='function')fail('PQ_SDK_NOT_SUPPLIED');
  for(const name of ['assertCanPrepare','saveKeys','readKeys','verifySavedKeys'])if(typeof repository?.[name]!=='function')fail('PQ_PROTECTED_VAULT_NOT_SUPPLIED');
  if([getOriginalNetwork,getRegisteredBinding,readRestoreInput].some(v=>typeof v!=='function'))fail('PQ_ORIGINAL_BINDING_SOURCE_REQUIRED');
  const materials=new WeakMap();
  async function networkFor(binding,guard){
    guard.assert();const original=sdk.validatePQNetworkBinding(await getOriginalNetwork({account:binding.account,guard}));guard.assert();
    if(original.chainId!==binding.network)fail('PQ_KEY_BINDING_CHANGED');
    return original;
  }
  function selected(material){const value=materials.get(material);if(!value)fail('PQ_ORIGINAL_KEY_HANDLE_REQUIRED');return value;}
  async function current(material,binding,guard,readOnly=false){
    const value=selected(material),network=await networkFor(binding,guard);
    if(value.publicCausePresent)throw value.publicCause;
    if(value.retired&&!readOnly)fail('PQ_KEY_HANDLE_RETIRED');
    if(value.account!==binding.account||value.binding.chainId!==network.chainId||value.binding.owner!==network.owner)fail('PQ_KEY_BINDING_CHANGED');
    if(!value.retired){const original=sdk.readPQWalletKeyPublic(value.handle);sdk.assertPQPublicBindingMatches(original,value.binding);}guard.assert();return value;
  }
  return Object.freeze({
    async prepare(kind,{binding,guard}){
      const network=await networkFor(binding,guard);let handle;
      await repository.assertCanPrepare({kind,account:binding.account,network,guard});guard.assert();
      if(kind==='generate')handle=await sdk.createPQWalletKeyHandle(network);
      else if(kind==='restore'){
        const expected=await getRegisteredBinding({network,account:binding.account,guard});guard.assert();
        if(expected?.chainId!==network.chainId||expected?.owner!==network.owner)fail('PQ_KEY_BINDING_CHANGED');
        const input=await readRestoreInput({guard});guard.assert();
        if(!input||!(input.wire instanceof Uint8Array)||typeof input.credential!=='string')fail('PQ_RECOVERY_INPUT_REQUIRED');
        // Expected keys come only from the original/on-chain source above.
        handle=await sdk.restorePQWalletKeyHandle(input.wire,input.credential,expected);
      }else fail('PQ_KEY_PREPARATION_KIND_INVALID');
      // Capture the returned SDK handle before ANY post-operation fence or
      // public-key accessor can throw. The controller receives this exact
      // private material even if the original lifecycle has just locked.
      const material=Object.freeze(Object.create(null));
      const value={handle,account:binding.account,binding:null,network,retired:false,retirementEntered:false,publicCausePresent:false,publicCause:undefined};materials.set(material,value);
      // Capture metadata while the SDK handle is still readable, but never
      // lose a returned handle if its public accessor itself fails.
      try{value.binding=sdk.readPQWalletKeyPublic(handle);}catch(error){value.publicCause=error;value.publicCausePresent=true;}
      return material;
    },
    async persist(material,{binding,operationId,guard}){
      const value=await current(material,binding,guard);
      return repository.saveKeys({handle:value.handle,publicBinding:value.binding,operationId,account:binding.account,guard});
    },
    async reconcile(material,{binding,operationId,guard}){
      const value=await current(material,binding,guard,true);
      return repository.readKeys({handle:value.handle,publicBinding:value.binding,operationId,account:binding.account,readOnly:true,guard});
    },
    async verifyPersisted(material,receipt,{binding,operationId,guard}){
      const value=await current(material,binding,guard,true);
      const verified=await repository.verifySavedKeys({handle:value.handle,publicBinding:value.binding,receipt,operationId,account:binding.account,readOnly:true,guard});guard.assert();return verified===true;
    },
    retire(material){const value=selected(material);value.retired=true;if(!value.retirementEntered){value.retirementEntered=true;sdk.destroyPQWalletKeyHandle(value.handle);}return sdk.readPQWalletKeyCleanupOutcome(value.handle);},
    // Main-only selection for eventual protected-vault recovery/retirement.
    // Never export this function through the renderer preload.
    selectOriginal(material,observer){if(typeof observer!=='function')fail('PQ_KEY_RECOVERY_OBSERVER_REQUIRED');return observer(Object.freeze({...selected(material)}));},
  });
}
