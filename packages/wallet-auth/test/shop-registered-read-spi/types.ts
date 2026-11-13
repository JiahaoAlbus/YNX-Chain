import {initializeOriginalShopRegisteredReadForProductSource} from '../../src/original-shop-registered-read-normal-private.js';
const result=initializeOriginalShopRegisteredReadForProductSource({},{});
result.then(x=>{const error:unknown=x.error;void error;
// @ts-expect-error readonly original owner
x.owner={};});
// @ts-expect-error parent is opaque object, never primitive
initializeOriginalShopRegisteredReadForProductSource('parent',{});
// @ts-expect-error genuineRead required
initializeOriginalShopRegisteredReadForProductSource({});
