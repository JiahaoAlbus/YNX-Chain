import {createProductWalletBusinessReadClient} from '../../src/product-wallet-connection.js';
import type {ProductWalletBusinessReadConfiguration} from '../../src/product-wallet-connection.js';
import type {OriginalProductSessionDeviceCurrentV4,ProductSessionDevicePortsV4,ProductSessionDeviceCurrentExpectedV4} from '../../src/product-session-device-v4.js';
import {readProductSessionV4BoundedHTTPHeaders} from '../../src/product-session-device-v4.js';
declare const config:ProductWalletBusinessReadConfiguration;
const client=await createProductWalletBusinessReadClient(config),result=await client.createBusinessProof({method:'GET',path:'/api/v1/status',body:'',requiredScopes:['developer:deploy']});
const header:'x-ynx-product-session-proof-v4'=result.proofHeaderName;void header;
// @ts-expect-error Data/JSON is not an actual held current owner.
const owner:OriginalProductSessionDeviceCurrentV4={};void owner;
// @ts-expect-error New device ports have no P256 public key/signer fallback.
const legacy:ProductSessionDevicePortsV4={id:'x',key:'x',sign:async()=>''};void legacy;
// @ts-expect-error HTTP4 producers never accept an arbitrary purpose/raw signer.
config.device.produceHTTPProof({version:'4',networkId:'00',unsigned:{},purpose:'TX-BATCH'},owner,{signal:new AbortController().signal});
// @ts-expect-error Caller endpoints are not normal runtime qualification.
createProductWalletBusinessReadClient({...config,endpoint:'https://other.invalid'});
// @ts-expect-error A read lease cannot create a write proof.
client.createBusinessProof({method:'POST',path:'/api/v1/status',body:'',requiredScopes:['developer:deploy']});
// @ts-expect-error Version4 cannot use the classic header label.
const old:'x-ynx-product-session-proof-v2'=result.proofHeaderName;void old;
// @ts-expect-error Opening a read lease never mints Native permission.
const admitted:true=result.NativeAdmission;void admitted;
// @ts-expect-error Budget parsing does not prove a counterpart was deployed.
const deployed:true=readProductSessionV4BoundedHTTPHeaders([]).counterpartDeployed;void deployed;
// @ts-expect-error Current expected includes full network/account/client/device/generation identity.
const partial:ProductSessionDeviceCurrentExpectedV4={registrationId:'x'};void partial;
await client.close();
