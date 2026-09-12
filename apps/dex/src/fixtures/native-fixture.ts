import golden from './finance-snapshot-fixture.json';
// Test-only adaptation of the exact Core golden fixture, never a runtime fallback.
export const GOLDEN_ACCOUNT=golden.account.address;
export function nativeFixture(account:string|null=GOLDEN_ACCOUNT):Record<string,any>{
  const value:Record<string,any>=structuredClone(golden);
  value.asOf=value.updatedAt=new Date().toISOString();
  if(account===null){value.account=null;value.balances=[];value.coverage.balances=false;}
  else {value.account.address=account;for(const b of value.balances)b.account=account;}
  return value;
}
