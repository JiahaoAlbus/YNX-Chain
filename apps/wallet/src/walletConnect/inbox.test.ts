import assert from "node:assert/strict";
import {test} from "node:test";
import {consumeWalletConnectDeepLink,offerWalletConnectDeepLink,subscribeWalletConnectDeepLinks} from "./inbox";

const link=(id:number)=>`ynxwallet://wc?uri=wc%3A${id}`;

test("cold-start pairing links retain order, deduplicate and never silently replace one another",()=>{
  const first=link(1),second=link(2),seen:string[]=[];
  offerWalletConnectDeepLink(first);offerWalletConnectDeepLink(second);offerWalletConnectDeepLink(first);
  const unsubscribe=subscribeWalletConnectDeepLinks(url=>seen.push(url));
  assert.deepEqual(seen,[first]);
  consumeWalletConnectDeepLink(second);
  assert.deepEqual(seen,[first]);
  consumeWalletConnectDeepLink(first);
  assert.deepEqual(seen,[first,second]);
  consumeWalletConnectDeepLink(second);unsubscribe();
});

test("full pairing inbox rejects a fifth link without dropping the first four",()=>{
  const links=[3,4,5,6].map(link),seen:string[]=[];
  for(const item of links)offerWalletConnectDeepLink(item);
  assert.throws(()=>offerWalletConnectDeepLink(link(7)),/inbox is full/);
  const unsubscribe=subscribeWalletConnectDeepLinks(url=>seen.push(url));
  for(const item of links)consumeWalletConnectDeepLink(item);
  assert.deepEqual(seen,links);
  unsubscribe();
  assert.throws(()=>offerWalletConnectDeepLink("https://evil.example/wc"),/invalid/);
});
