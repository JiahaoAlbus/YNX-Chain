// Build-time original productPlatformBinding projection, private SOURCE role.
// Not a URL parser, Root map, registration or runtime-selected provider.
import data from'./original-source-finite-product-registry-data.json'with{type:'json'};
import{canonicalJSON,WalletAuthError}from'../src/canonical.js';
const seal=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))seal(x);Object.freeze(v);}return v;};seal(data);
const fail=()=>{throw new WalletAuthError('SOURCE_PRODUCT_ROLE_NOT_SUPPORTED','Product binding is outside the fixed SOURCE-only role');};
export const PRODUCT_SESSION_PLATFORMS=data.platforms;
export function parseProductSessionRegistry(value){if(canonicalJSON(value)!==data.originalRegistryCanonical)fail();return data.parsedRegistry;}
export function productPlatformBinding(value,productId,platform){parseProductSessionRegistry(value);if(!data.roleProductIds.includes(productId))fail();const row=data.bindings[productId+'|'+platform];if(!row)fail();return row;}
// ONLY the known app origin/callback operands of original session/registration
// validators use this lexical data view. No global URL is installed. Root/node/
// Source-current endpoints, resolvers and arbitrary URLs never pass through it.
export class SourceFiniteURLDataView {
 constructor(value){if(arguments.length!==1||typeof value!=='string'||!Object.hasOwn(data.urlViews,value))fail();Object.assign(this,data.urlViews[value]);Object.freeze(this);}
 toString(){return this.href;}
}
