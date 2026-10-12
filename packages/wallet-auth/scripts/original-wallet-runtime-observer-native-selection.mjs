// Fixed daemon owner selection only. It must come from lawful independent root,
// ROLE and instance registration, never ENV/request/metadata/listening inference.
// Exact {instanceSource,roleBinding}; both are separately verified by observer.
export const originalWalletRuntimeObserverSelection=null;
