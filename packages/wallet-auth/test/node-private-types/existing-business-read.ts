import {createProductWalletBusinessReadClient} from '../../src/product-wallet-connection.js';import type {ProductWalletBusinessReadConfiguration} from '../../src/product-wallet-connection.js';
declare const cfg:ProductWalletBusinessReadConfiguration;const read=await createProductWalletBusinessReadClient(cfg);
await read.createBusinessProof({method:'GET',path:'/v1/status',body:'',requiredScopes:['developer:deploy']});
// @ts-expect-error Native read does not accept browser custody.
createProductWalletBusinessReadClient({...cfg,platform:'web'});
// @ts-expect-error No caller endpoint/provider selection.
createProductWalletBusinessReadClient({...cfg,endpoint:'https://other.invalid'});
// @ts-expect-error There is no restore/login method on a read-only lease.
read.restore();
// @ts-expect-error No write request can use this native read lease.
read.createBusinessProof({method:'POST',path:'/v1/status',body:'',requiredScopes:['developer:deploy']});
// @ts-expect-error GET binds only the actual empty body.
read.createBusinessProof({method:'GET',path:'/v1/status',body:'{}',requiredScopes:['developer:deploy']});
// @ts-expect-error Opening a read lease never manufactures Connected.
const connected:true=read.capabilities.connected;void connected;read.close();
