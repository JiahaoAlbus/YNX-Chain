import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeForRoute,scopeForMutation} from './permissions.ts';

test('each Card route binds one minimum scope without legacy escalation',()=>{
  const cases=[
    ['GET','/state','account:read'],['GET','/cards/c/statement','account:read'],
    ['POST','/applications','card:application:write'],['PATCH','/applications/a','card:application:write'],
    ...['approval-request','submit','cancel'].map(action=>['POST','/applications/a/'+action,'card:application:write']),
    ...['freeze','unfreeze','close','recover'].map(action=>['POST','/cards/c/'+action,'card:controls:write']),
    ['PUT','/cards/c/controls','card:controls:write'],['POST','/cards/c/topup-intents','card:topup:write'],['POST','/topups','card:topup:write'],
    ['POST','/cards/c/authorizations','card:simulation:write'],['POST','/authorizations/a/capture','card:simulation:write'],['POST','/authorizations/a/reverse','card:simulation:write'],['POST','/captures/c/refund','card:simulation:write'],
  ];
  for(const [method,path,scope] of cases)assert.equal(scopeForRoute(method!,'/api/card/v1'+path),scope);
  for(const method of ['GET','DELETE','PATCH'])assert.throws(()=>scopeForRoute(method,'/api/card/v1/topups'),/ROUTE_NOT_FOUND/);
  assert.throws(()=>scopeForRoute('POST','/api/card/v1/captures/c/capture'),/ROUTE_NOT_FOUND/);
});

test('internal mutation operations also enforce exact permission before cache use',()=>{
  for(const operation of ['create','update:a','approval:a','submit-start:a','submit-finish:a','submit-failure:a','cancel:a'])assert.equal(scopeForMutation('applications:'+operation),'card:application:write');
  assert.equal(scopeForMutation('topup-confirm:i'),'card:topup:write');
  assert.equal(scopeForMutation('topup-intent:c'),'card:topup:write');
  for(const operation of ['authorization:c','capture:a','reverse:a','refund:c'])assert.equal(scopeForMutation(operation),'card:simulation:write');
  for(const operation of ['card:freeze:c','card:unfreeze:c','card:close:c','card:recover:c','controls:c'])assert.equal(scopeForMutation(operation),'card:controls:write');
  assert.throws(()=>scopeForMutation('anything:write'),/OPERATION_NOT_ALLOWED/);
});
