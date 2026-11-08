import{acquireOriginalShopPrivateClient,isOriginalShopPrivateClient,type OriginalShopCurrent}from'../../src/original-shop-private-client.js';const p=acquireOriginalShopPrivateClient();if(p.owner){const result:Promise<unknown>=p.owner.readOriginalShopNativeInvoiceRequestDATA('ord_123',Object.assign(()=>undefined,{signal:new AbortController().signal}) as OriginalShopCurrent);void result;const closed:boolean=p.owner.isClosed();void closed;}const input:unknown={};if(isOriginalShopPrivateClient(input))input.retire();
// @ts-expect-error no provider/root/path parameters
acquireOriginalShopPrivateClient({provider:()=>{}});
// @ts-expect-error unknown business DATA must pass original P06 validator
if(p.owner){const v=await p.owner.readOriginalShopNativeInvoiceRequestDATA('ord_123',Object.assign(()=>undefined,{signal:new AbortController().signal}) as OriginalShopCurrent);v.amountAtoms;}
