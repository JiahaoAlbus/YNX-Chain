// PUBLIC fixed-native-image redirect ONLY for this test worker. No real Source.
let state;
export function configurePUBLICHTTPV5Source(value){state=value;}
export function loadOriginalAuthIdentityNativeImage(){return Object.freeze({acquireOriginalProductSessionHTTPProofV5Source(){state.acquires++;return state.source;}});}
