import {Buffer} from 'node:buffer';
import {acquireOriginalPendingPairQueryServerV1,assertOriginalPendingPairQueryServerOwnerV1,createOriginalPendingPairQueryHTTPHandler} from '../../src/product-pair-pending-query-server.mjs';
async function consume(){const result=await acquireOriginalPendingPairQueryServerV1();const partial=result.owner; // FIRST retain original partial
 if(result.error!==null){await partial?.close();return;}
 const owner=assertOriginalPendingPairQueryServerOwnerV1(partial);await owner.query(Buffer.from('PUBLIC'),Buffer.from('PUBLIC'));createOriginalPendingPairQueryHTTPHandler(owner);}
// @ts-expect-error no request-supplied Source/root/approval constructor
acquireOriginalPendingPairQueryServerV1({approved:true});
// @ts-expect-error Source authority is not structural DTO or public kernel
createOriginalPendingPairQueryHTTPHandler({query:async()=>({})});
// @ts-expect-error no method/path/actor/keys can be selected by caller
acquireOriginalPendingPairQueryServerV1('/v4/product-pairs');
void consume;
import{acquireOriginalRegisteredManagementServerV4,acquireOriginalCompletionQueryServerV4,createOriginalManagementV4HTTPHandler,assertOriginalProductSessionManagementServerV4}from'../../src/product-session-management-server.mjs';
async function management(){const r=await acquireOriginalRegisteredManagementServerV4(),partial=r.owner;if(r.error!==null){await partial?.close();return;}const owner=assertOriginalProductSessionManagementServerV4(partial);await owner.execute('active',Buffer.from('PUBLIC'),'PUBLIC');createOriginalManagementV4HTTPHandler(owner);}
// @ts-expect-error no public root/provider/allowlist setter
acquireOriginalRegisteredManagementServerV4({approved:true});
// @ts-expect-error pending and completion Source are not caller selectors
acquireOriginalCompletionQueryServerV4('pending');
// @ts-expect-error no structural callback object is a normal server owner
createOriginalManagementV4HTTPHandler({execute:async()=>Buffer.from('approved')});
void management;
