import {createNativeProductSessionClient,type NativeProductRuntime,type NativeProductPlatform} from "@ynx-chain/wallet-auth/product-session-native";
import type {ProductSessionGatewayFetchAdapter} from "@ynx-chain/wallet-auth";
export async function consume(registry:unknown,gateway:ProductSessionGatewayFetchAdapter,runtime:NativeProductRuntime,platform:NativeProductPlatform){
 const client=await createNativeProductSessionClient({registry,productId:"social",platform,scopes:["account:read","social.feed"],purpose:"Explicit Native Social access",gateway,runtime,clock:()=>new Date()});
 const opened=await client.connect();const approvalIsStillRequired:false=opened.approved;
 await client.restore();await client.createBusinessProof({method:"POST",path:"/social/v3/native/read",body:"{}",requiredScopes:["social.feed"]});await client.disconnect();return approvalIsStillRequired;
}
// @ts-expect-error A browser cannot enter the native protected adapter.
const forbiddenPlatform:NativeProductPlatform="web";
