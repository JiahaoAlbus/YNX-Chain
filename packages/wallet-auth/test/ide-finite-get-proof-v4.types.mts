import{type IDEFiniteGETDeviceContextV4,type IDEFiniteGETExpectedV4,prepareIDEFiniteGETUnsignedV4DATA,createIDEFiniteGETProofHeaderV4DATA,inspectIDEFiniteGETProofHeaderV4DATA}from'../src/original-ide-finite-get-proof-v4.js';import type{OriginalIDECloudGETRequestDATA}from'../src/original-ide-cloud-get-request.js';import type{ProductSessionHTTPProofV4Expected}from'../src/product-session-proof-v4.js';declare const request:OriginalIDECloudGETRequestDATA;declare const expected:IDEFiniteGETExpectedV4;declare const device:IDEFiniteGETDeviceContextV4;declare const verification:ProductSessionHTTPProofV4Expected;const stage=prepareIDEFiniteGETUnsignedV4DATA(request,expected,device);const h=createIDEFiniteGETProofHeaderV4DATA(stage,request,new Uint8Array(),verification,1);const no:false=h.receiverAccepted;
// @ts-expect-error V5 cannot alias V4
prepareIDEFiniteGETUnsignedV4DATA(request,expected,{...device,version:'5'});
// @ts-expect-error POST not registered
prepareIDEFiniteGETUnsignedV4DATA({...request,method:'POST'},expected,device);
// @ts-expect-error nobody field
prepareIDEFiniteGETUnsignedV4DATA({...request,body:''},expected,device);
// @ts-expect-error no injected signer/provider
prepareIDEFiniteGETUnsignedV4DATA(request,{...expected,signer:()=>true},device);
// @ts-expect-error device registered revision is lossless string
prepareIDEFiniteGETUnsignedV4DATA(request,expected,{...device,deviceRegistrationRevision:9007199254740992});
// @ts-expect-error V2 header rejected
inspectIDEFiniteGETProofHeaderV4DATA(stage,request,{headerName:'x-ynx-product-session-proof-v2',headerValue:''},verification,1);
// @ts-expect-error metadata is not permission
const grant:true=h.permission;

const noDispatch:false=h.dispatch;
