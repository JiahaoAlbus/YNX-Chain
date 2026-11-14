export const returnLinkChecks = ['ACTIVITY_USABLE', 'SDK_SUPPORTED', 'PACKAGE_MATCH', 'APPROVED_PINS_PRESENT', 'APPROVED_PINS_VALID', 'SIGNERS_PRESENT', 'SIGNERS_MATCH', 'CALLBACK_ACTIVITY_ENABLED', 'DOMAIN_MANAGER_PRESENT', 'DOMAIN_STATE_PRESENT', 'DOMAIN_VERIFIED', 'EXACT_RESOLVER'] as const;
export type ReturnLinkDiagnostic = Readonly<{state: 'NOT_STARTED' | 'CHECKING' | 'PASSED' | 'REJECTED'; check: typeof returnLinkChecks[number] | 'NOT_CHECKED' | 'ALL_CHECKS'; outcome: 'RETURNED_FALSE' | 'THREW_EXCEPTION' | 'NOT_CHECKED' | 'PASSED'; completedChecks: number; totalChecks: number}>;
export function decodeReturnLinkDiagnostic(raw: unknown): ReturnLinkDiagnostic {
  const fail = () => {throw Error('INVALID_RETURN_LINK_DIAGNOSTIC');};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) return fail();
  const f = Object.getOwnPropertyDescriptors(raw), keys = ['state','check','outcome','completedChecks','totalChecks'];
  if (Reflect.ownKeys(f).length !== keys.length || !keys.every(k => f[k]?.enumerable && Object.hasOwn(f[k], 'value'))) return fail();
  const state=f.state?.value, check=f.check?.value, outcome=f.outcome?.value, completedChecks=f.completedChecks?.value, totalChecks=f.totalChecks?.value;
  if (totalChecks !== returnLinkChecks.length || !Number.isInteger(completedChecks) || completedChecks < 0 || completedChecks > totalChecks) return fail();
  if (state === 'NOT_STARTED') {if (completedChecks !== 0 || check !== 'NOT_CHECKED' || outcome !== 'NOT_CHECKED') return fail();}
  else if (state === 'CHECKING') {if (check !== 'NOT_CHECKED' || outcome !== 'NOT_CHECKED') return fail();}
  else if (state === 'PASSED') {if (completedChecks !== totalChecks || check !== 'ALL_CHECKS' || outcome !== 'PASSED') return fail();}
  else if (state === 'REJECTED') {if (!returnLinkChecks.includes(check) || !['RETURNED_FALSE','THREW_EXCEPTION'].includes(outcome)) return fail();}
  else return fail();
  return Object.freeze({state,check,outcome,completedChecks,totalChecks});
}
